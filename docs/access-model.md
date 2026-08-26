# Access model — how a household joins, and what that actually protects

- Date: 2026-08-05, substantially revised 2026-08-06, **superseded again 2026-08-11 by story #62**
- Decided by: owner (SailorDave17), at pickup of story #5, overridden at pickup of story #23, and
  again at pickup of #62
- Story: #5 (schema, policies, the bypass test), #23 (per-member credentials, column grants),
  #34 (chores, which inherits the column-grant convention), #36 (assignment, which is the first
  to make the convention's rule structural as well as procedural) and **#62 (per-member sign-in,
  which retires device auth entirely)**
- Status: **`0001`–`0012` are applied to the live project**, `0001`–`0008` as of 2026-08-20 (#108),
  `0009` on 2026-08-21, and `0010`–`0012` on 2026-08-24. **`0013` (the inherited grants, #91) exists
  in the repo and has NOT been pasted** — and unlike every previous entry in that sentence, it does
  **not** appear in the expected-red set below, because `check:live` is structurally blind to it.
  See the *two* migrations that bullet cannot speak for. `0007` and `0008` were
  pasted together, which is what emptied the expected-red set the first time. `0002` is verified
  over the wire by the live RLS suite (PR #65, 13/13 against the real project); `0007`, `0008`,
  `0010` and `0011` are verified by `npm run check:live` — every table, every RPC, and (since #115)
  both Edge Functions; the rest are verified only by the paste succeeding. The denominator moved
  from 20 to 21 on 2026-08-21 when #37 added `chore_exclusions` to `LIVE_SCHEMA`, to 23 on
  2026-08-24 when #95 added `calendar_connections` and the `calendar-connect` Edge Function, and to
  **24** the same day when #53 added the `catch_up_repeats` RPC. `0013` does not move it, and that
  is the point of the bullet above rather than an oversight.

  *This Status line said `0012` had NOT been pasted until 2026-08-24, while the expected-red bullet
  twelve lines below had recorded it pasted and measured at 24 of 24 since the same evening. PR #139
  corrected the bullet and stopped there — the edit was framed as fixing the paragraph about the
  paste, not as correcting a fact that this page states in two places. Found and fixed by #91, which
  had to edit this header for an unrelated reason. Noted rather than quietly repaired, because the
  next reader's question is which of the two copies was wrong, and it was this one.*
- **`0009` landed on 2026-08-21 and `0010` and `0011` on 2026-08-24, and all three are verified over
  the wire — but not by the same instrument, and that is the thing to carry.** `0011` went in first
  of its pair, out of file order and ahead of its own PR merging, which is allowed and is worth
  noting rather than tidying away. Nothing in `0011` depends on `0009` or `0010`; it references
  `households` and `members`, both of which predate all three.
  - **`0009`** (#127) — the two indexes that made membership per-database rather than per-household.
    **Pasted 2026-08-21, confirmed by `npm run test:rls`** and by nothing else, because `check:live`
    cannot see an index: see the blindness bullet below. That suite cannot reach its first assertion
    unless `0009` is applied — `beforeAll` puts one seeded account in two households, which the
    pre-`0009` global `members_claimed_by_key` forbids, and that is exactly how #127 was found.
    *Re-measured 2026-08-24: 31 of 31, no skips.* **A suite that fails at setup under the old schema
    is a stronger presence check than any probe**, because it cannot pass for the wrong reason.
  - **`0010`** (#37) — the exclusions table and the two eligibility functions. **Pasted 2026-08-24,
    verified over the wire**: `chore_exclusions` answers with exactly its four granted columns, and
    that assertion had been red by design from the merge until the paste.
  - **`0011`** (#95) — `calendar_connections`, which the client reads, and `calendar_tokens`, which
    it is granted nothing on. **Pasted 2026-08-24, verified over the wire.** **The first credential
    this schema holds that belongs to somebody else**: a Google refresh token is a bearer credential
    for a person's calendar and does not expire on its own. It is a separate table rather than a
    withheld column on purpose — a column grant is a list somebody edits, and adding a column to the
    wrong `grant select (...)` line is a one-word diff that reads like the twenty others in these
    files and fails silently. The equivalent mistake here is a whole new grant statement, which is a
    thing a reader argues with.
  - **`0011` also needed a DEPLOY, not only a paste**, and it is the only migration on this page
    that does: `calendar-connect` is an Edge Function, and `npm run deploy:function` is what puts it
    there. Two actions, two expected reds — and, as this page said it would, **the paste cleared
    only its own**. Both have now happened.
  - **`check:live` is blind to `0009` and NOT blind to `0010` or `0011`, and the difference is worth
    knowing
    because it is a property of the migrations rather than of the check.** `0009` changes only two
    indexes, and the check covers tables, columns, RPCs and Edge Functions — so it stays green
    either way and its green is *not* evidence that `0009` has been pasted. **That is not a stale
    warning now that the paste has happened — it is the reason `0009` is confirmed by a different
    instrument entirely**: this check's green read the same on both sides of that paste, so it
    carries no information about it in either direction. `npm run test:rls` is what settles it, and
    it settles it at setup rather than in an assertion. `0010` creates a TABLE the client reads, so
    the check could see it and was red on it by design until the paste. One migration ahead of the
    project was invisible to the instrument and the other was loud, from the same instrument, on the
    same day.

    `0011` is a third case and it is **half visible**, which is the sharpest of the three.
    `calendar_connections` is read by the client, so the check asks about it and was red until the
    paste. `calendar_tokens` is **deliberately not in `LIVE_SCHEMA`**, and its absence is the check
    agreeing with the schema rather than an omission: no client is granted anything on that table,
    so a probe would report a missing grant on a project that is entirely correct — the
    `household_devices` mistake with the sign flipped. Both tables arrive in one file, so a project
    with the connection table has run the whole of it. `liveSchema.test.js` asserts the token table
    is absent from the list rather than leaving that to be inferred, because an entry left out on
    purpose and one forgotten look identical.
- **`0013` (#91) is the odd one out: it grants privileges the live project already has.** Supabase's
  default ACL for tables created by `postgres` in `public` used to be `arwdDxtm` and is now `Dxtm` —
  truncate, references, trigger, maintain, and no DML at all. Every migration up to `0012` that
  wanted to keep a privilege wrote a NARROW revoke and let the rest ride on that default, which
  works only while the default is generous. *Measured 2026-08-24* against a database built from
  `supabase/migrations/` alone, three of the seventeen operations the client issues were refused:
  `households` `select('*')` (the app cannot load past the shell), `members` delete and `chores`
  delete (removing a person, removing a chore). All four DELETE policies already existed and were
  correct — only the grants were missing, which is why `0013` contains no policy.

  The pattern predicts where a fourth instance would be. `member_capacity` (`0005`) and
  `chore_exclusions` (`0010`) each write `grant delete` explicitly and are fine; `members` (`0002`,
  `0007`) and `chores` (`0003`) narrow their revoke and inherit the rest, and both were broken.
  `0003` even says so in prose at line 161 — *"DELETE stays granted to `authenticated`"* — which was
  true of the platform it was written against and has not been true since. **Nothing executes a
  comment**, so it went on reading as a decision.

  Paste it when convenient rather than urgently: on the live project it changes nothing observable,
  and on a rebuilt one it is the difference between an app that loads and an app that does not.
- **This page is prose about live state and prose is what failed here** — see the correction at the
  head of *What is not done*. Since #78 the authority is a **check, not this page**: run
  `npm run check:live` and believe its output. What is written here is the *reasoning* — why each
  migration exists and what it grants — which is the half a check cannot carry.
- **`check:live` has TWO expected reds, and both clear on a single paste.**
  ***Measured 2026-08-26*** against the live project, on the #159 branch before
  the paste: **22 of 24**, with `members` and `chores` each answering
  `42501 permission denied` because the client now asks for `household_id` and
  the live project has not granted it. That is the check working, not a fault -
  and unlike `0013` it is a red that could not have been faked, because the
  column has never been readable by `authenticated` on any project.
  ***Measured 2026-08-24*** against the live project, after `0012` was pasted that evening:
  **24 of 24**. The two reds this bullet carried for part of that day — the `chores` repeat columns
  and `catch_up_repeats()` — cleared on exactly the one action they named, and on nothing else.
  Nothing is on loan: the check's authority is whole, and a red on any subject is a real failure
  rather than a queued paste.

  **The empty set is the state this whole form exists to reach, and it is the state to defend.**
  While a red is excused, the check's authority is on loan: a genuine failure of the excused subject
  reads as the expected one and gets waved through, which is precisely how a real outage hid in
  plain sight on 2026-08-09. With nothing excused, the instrument answers the only question worth
  asking in one bit.

  **The excused reds, and the single condition that clears each**, kept in the form this page has
  used four times before so that a future entry cannot quietly become permanent:

  | Red | Cleared by | Anything else? |
  |---|---|---|
  | `members` refuses `household_id` (`42501`) | Pasting `supabase/migrations/0014_scope_reads_to_one_household.sql` | **No.** Not a deploy, not a promotion to `release`, not another migration. `0014` is two `grant` statements and nothing else. |
  | `chores` refuses `household_id` (`42501`) | The same paste — the file grants both tables in one go | **No.** Both rows clear together or neither does; there is no state where one is granted and the other is not. |

  **The queue is NOT drained — #159 added a row, deliberately, and that is what a
  new migration is supposed to do to this table.** The row above is the expected
  red between the merge of #159 and the owner's paste; until then `check:live`
  reports the client asking for a column the live project has not granted, which
  is the check working rather than a fault. #162 is the story that confirms the
  paste and REMOVES that row.

  Unlike `0013`, this migration is **observable**: `0013` granted privileges the
  live project already held by inheritance, so the probe read the same on both
  sides of the paste and could not testify that it had happened. `0014` grants a
  column that has never been readable by `authenticated` anywhere, and every
  table probe is `select(<columns>).limit(0)` signed in as that role — so the
  red is real before and gone after, on exactly this action.

  **What follows describes the state before #159 and is kept as history.** The two rows that
  stood here earlier on 2026-08-24 — the `chores` repeat columns and `catch_up_repeats()` — were
  both cleared by the single paste of `supabase/migrations/0012_repeating_chores.sql` that evening,
  *measured* at **24 of 24**. They are recorded in the inversion history below rather than left
  standing here, because **a drained queue nobody re-reads looks exactly like one that never
  drained**, and an excused row that outlives its condition is the failure this form exists to
  prevent.

  **Both of the rows that stood here on 2026-08-24 cleared on exactly the action they named, and on
  nothing else** — which is the claim this table makes every time, and the reason it is written as a
  table rather than a sentence:

  | Red that stood here | Cleared by | Held? |
  |---|---|---|
  | `chore_exclusions exists, with every column the app selects` | pasting `supabase/migrations/0010_chore_exclusions.sql` | Yes. Nothing else touched it. |
  | `calendar-connect is deployed, and a browser could actually call it` | `npm run deploy:function` | Yes, and the sharper half: **the `0011` paste did not clear it**, exactly as the row predicted. A migration and a deploy are different actions against different systems, which is the whole reason `LIVE_EDGE_FUNCTIONS` is a separate list. |

  *A third row stood for about an hour on 2026-08-24 — `calendar_connections`, awaiting the `0011`
  paste — and cleared on exactly the action it named too. It is recorded here rather than deleted
  because a row that appears and clears within a session is the same evidence as one that stands for
  days; deleting the short-lived ones would leave a history that flatters the queue.*

  The two eligibility functions `0010` creates are deliberately **not** probed, and their absence
  from the check is not a gap: `0010` withholds `execute` from `authenticated`, so a probe would
  report a missing grant on a project that is entirely correct — the `household_devices` mistake
  with the sign flipped. They arrive in the same paste as the table, so a project with the table has
  run the whole file.

  **`0009` and `0013` are the two migrations this bullet cannot speak for at all**, and it is worth
  stating here rather than only four bullets up, because an empty excused-red set is easy to read as
  *the database matches the repo* and it does not mean that. The check covers tables, columns, RPCs
  and Edge Functions.

  - **`0009`** is two indexes, so this bullet would read exactly the same whether that migration had
    been pasted or not. It has been — `npm run test:rls` confirms it, at setup — but the
    confirmation comes from somewhere else entirely.
  - **`0013`** (#91) is three grants, and it is blind in a way `0009` is not: `0009` is invisible
    because the check has no index probe, while `0013` is invisible because **the live project
    already holds all three privileges by inheritance**. The check signs in as `authenticated` and
    reads `households` with `select('*')`; that succeeded before `0013` existed and succeeds after
    it is pasted. There is no reading of `check:live`, and no reading of any instrument reachable
    over PostgREST, that differs across that paste — `information_schema` is not exposed, and the
    only difference `0013` makes on the live project is a catalog entry nobody can query.

    So `0013` is the first migration here whose paste is **unobservable by design rather than by
    omission**, and that is the same fact as its being a no-op on the live project (#91 AC 5). What
    it changes is a project rebuilt from these files, where those privileges do not exist at all and
    the app cannot load past its first screen. The instrument that covers it is
    `src/test/grants.pglite.test.js`, which runs in CI against the migrations rather than against
    the project, and there is no way to move that coverage over the wire.

  **An empty excused-red set is a claim about the subjects the instrument has**, never about the
  ones it does not — and with `0013` the gap is now two migrations wide rather than one.

  *The history of this bullet, which is the argument for keeping it in this form — and it has now
  been inverted seven times: EMPTY at 17 of 17, then ONE expected red at 19 of 20 when #115 gave the
  check its first sight of Edge Functions, then EMPTY again at 20 of 20, then ONE again at 20 of 21
  with #37's unpasted table, then TWO at a **measured** 21 of 23 with #37's table still unpasted and
  #95's function undeployed, then **EMPTY at 23 of 23** with both actions taken, then **TWO again
  at a measured 22 of 24** with #53's `0012` in the repo and unpasted, and now **EMPTY again at a
  measured 24 of 24**, `0012` having been pasted the same evening. A THREE was once written here
  first, from arithmetic, and never actually existed: the paste that would have cleared its third
  entry had already happened. **A predicted state is not a state**, and the register a count is
  written in — measured or derived — belongs beside it.* The non-empty states are the instructive
  ones. The set never grew because anything regressed — it grew because the check stopped being
  **blind** to something already broken, or, as this time, because the repo moved ahead of the
  live project on purpose — the window between a merge and a paste is exactly what the table is
  for, and reading it as a regression would be mistaking the instrument for the fault.

  **The clearing is worth more than the green, because the check's positive control could not
  discriminate until it happened.** While `calendar-connect` was undeployed, the real test and the
  control — a deliberately absent function name — returned the *same* verdict, so the pair proved
  nothing about the instrument. They now disagree: one reports deployed and callable, the other
  reports absent. A control that cannot yet tell two things apart looks identical to one that works,
  which is why that limit was written into the test file rather than left to be noticed. The same
  was true of `provision-member` on 2026-08-20, so it is a property of this design rather than an
  accident of either story.

  **Two corrections from 2026-08-24 are kept, because the count moved three times in one day.**

  The bullet said **THREE**, at a *predicted* 20 of 23, for about an hour. #95's session wrote the
  prediction under a stated caveat — that `check:live` could not run here for want of `.env.local`,
  so the count was arithmetic over the lists rather than a measurement. **The caveat was false**:
  the file exists, and had existed throughout. It was carried forward from a cairn note dated
  2026-08-21 without being checked, which is the ordinary way a status claim outlives its subject —
  *the note was accurate when written, and nothing about it announced that it had stopped being so*.
  The cheap lesson: **a claim that an instrument cannot be run is a claim about the environment, and
  it expires exactly like a claim about the project.** The cost of checking it was one command.

  It then said **TWO**, at a measured 21 of 23, and that was true when written and merged in PR #135
  — and false within hours, because the two owner actions it named were taken. That is not a defect
  in the sentence; it is what a correctly-written excused-red row is *for*. The defect would have
  been leaving it standing, because a stale excuse is indistinguishable from a live one, and it
  excuses precisely the two subjects most likely to fail next.

  **The hazard this form names is restated rather than dropped, for the sixth time.** An authority
  that is red by design and does not say so is one whose *next* genuine failure gets waved through.
  This page currently excuses **no** red at all: everything is new, real, and to be investigated
  rather than matched against a list. Each subject still has its own named test, so nothing can hide
  inside anything else.

  *This paragraph said "there is now **no** red this page excuses" until 2026-08-21, and it was
  true when written. It went false two paragraphs above where it sits, in the same edit that added
  the excused red — which is the failure mode of a correction that fixes the sentence about the
  subject and stops there. The repair is the one that costs nothing: after editing prose that
  states a value, grep the same file for the value.*

  *It said "exactly **one**" until 2026-08-24, and #95 found it by running exactly that repair —
  grepping this file for the value rather than for the subject. The count sat four screens below the
  bullet it belongs to, in a paragraph whose own subject is how a stale count gets waved through.
  Twice now the sentence about the hazard has been the thing carrying it.*

  *And it said "exactly **three**" for about an hour later the same day, which is the shortest-lived
  version yet. The value-grep worked again and is not the lesson; the lesson is that the grep was
  run against a count nobody had measured. **A correction sweep propagates whatever it is given** —
  it makes every copy agree, and says nothing about whether the agreed value is true. Running the
  instrument is a different act from synchronising the prose about it, and only one of them was done
  first.*

  *It said "exactly **two**" for about six hours after that — and this one is different in kind,
  because the sentence did not decay, **the world moved to meet it**. The queue it described was
  cleared by the two owner actions it named. A count that goes stale because somebody did the work
  is the good case, and the only thing it asks of this page is that the page be re-read after the
  work rather than only after an edit. Which is the argument for running `npm run check:live` when
  nothing in the repo has changed at all: on this page the subject moves without the file.*
- **RESOLVED 2026-08-20 — the `create_household` overload divergence, and the prediction that held.**
  Until `0007` was pasted, the live project carried `create_household(household_name, household_tz,
  organizer_name, organizer_pin)` — the four-argument version with the PIN — while the client since
  #62 called the three-argument one `0007` creates. Both are named `create_household`, so nothing
  that checked names alone could tell them apart, and the first run of #85's RPC check is what
  surfaced it on 2026-08-16. It shared one cause with the `members.email` red, which is why this page
  predicted **both would clear on the same paste** and why #108 was filed to check that rather than
  assume it. *Measured*: both cleared together. Kept rather than deleted because the mechanism is
  still live knowledge — PostgREST resolves an overload by its **set of argument names**, so a check
  written against names alone would have called this project healthy while every household creation
  in the app failed.

## Read this first — the decision below changed, twice

Two supersessions, and the second undoes an assumption the first was built on.

1. **2026-08-05 → 2026-08-06.** The original decision was *a household join code plus anonymous auth,
   pick yourself from the roster*. It was overridden in favour of **per-member credentials**: an
   organizer-set PIN on the member row, checked by the database.
2. **2026-08-06 → 2026-08-11 (#62).** That PIN scheme is now retired in favour of **real per-member
   auth users**, which is what the section below calls the upgrade path and explicitly does not
   reject on principle. Its stated blocker — *"the Supabase CLI is not installed, Docker is not
   running"* — is what changed, not the reasoning.

**What #62 actually changes**, in the order it matters:

- **`auth.uid()` is a PERSON, not a device.** `members.claimed_by` holds their auth user, and it is
  stable across time because a real credential returns the same user every session. That is what
  makes the whole thing possible.
- **`household_devices` is dropped.** It existed to absorb one hazard: an anonymous session expires
  after 30 idle days and returns with a *new* auth id, so a rarely-active member would have become a
  stranger to their own history. A stable auth id removes the hazard, so the table has nothing left
  to do. Membership now resolves through `public.current_household_ids()`, a `security definer`
  helper — necessary because a policy *on* `members` cannot subquery `members` without infinite RLS
  recursion, which Postgres refuses outright.
- **The join code is gone.** Not repurposed — dropped, along with `join_household` and
  `generate_join_code`. Admission is an account provisioned for one named person, so there is no
  shared secret to read out and nothing that works for whoever repeats it.

  **Partly superseded 2026-08-26** — see *"Decision taken 2026-08-26"* in
  [`refresh-charter.md`](refresh-charter.md). Admission gains a second route: an **invitation**, as
  a withdrawable single-use code and as an emailed link. The sentence above stays true in the part
  that mattered — there is still no shared household secret, because an invitation is created for a
  purpose, can be withdrawn, and is spent once. What changes is that provisioning is no longer the
  *only* way in. The names `join_household`, `generate_join_code` and `join_code` stay dropped and
  are not reused by the new mechanism.
- **PINs are gone as a database concept.** `pin_hash`, `has_pin`, `claim_member`,
  `claim_member_with_pin` and `set_member_pin` are all dropped, on this repo's rule that *a dead
  credential path which still works is a second way in*. A PIN can still be a person's password; the
  database no longer knows or cares.
- **`members.email` is the discriminator, and its nullability is the whole design.** A member with a
  real address signs in with it and carries a longer secret; a member without one gets a synthetic
  `<members.id>@taskr.invalid` address they never see or type, and a PIN. `.invalid` is reserved by
  RFC 2606, so a synthetic address can never reach a real inbox. There is deliberately **no separate
  `is_child` flag**, because a second field can disagree with the first.
- **`members.id` still does not move.** No history migrates. That was true before #62 and is the
  reason #62 was cheap — see *What it costs to change later*, which predicted this change and priced
  it correctly.

**Provisioning is DEPLOYED and live, since 2026-08-20.** Giving another person an account needs the
`service_role` key, so it needs the Edge Function — built by #87 (PR #92), deployed by
`npm run deploy:function` on 2026-08-20 (#112 AC 5), and proved from outside by `check:live`'s Edge
Function probe (#115), which is what the 20-of-20 bullet at the head of this page is reporting. An
organizer can add somebody to the roster and give them a sign-in, and that person signs in as
themselves. Since 2026-08-21 the live RLS suite exercises the whole path over the wire (#88): add a
member, provision them, sign in as them, and confirm the cross-household refusals still refuse.

*This paragraph said the deploy **"is owner-only and has not happened"** until 2026-08-21 — for a
day, while the header of this same page said `check:live` went green "immediately after
`npm run deploy:function`". PR #109 swept this document for exactly that claim and corrected the
sentences that named the function; these did not name it, so they survived. Two halves of one page
disagreed, and the stale half was the one in the section a reader opens to find out what is missing.
The step, and the check that proves it landed, are section 3 of `docs/deploy-runbook.md`.*

### Recovery, both directions — #62 AC 7 and AC 8

The story required these to be *decided and written down* rather than left to be discovered, so both
answers are here — and since 2026-08-20 both are live rather than one being "not yet".

**A member forgets their credential (AC 7).** The organizer resets it, and it still needs no inbox —
a synthetic `<id>@taskr.invalid` address has no mailbox to send a link to, by construction. The reset
is an admin password update, which needs `service_role`, so it lands with the Edge Function — built
by #87 (`provision-member`, action: `"reset"`; PR #92, merged 2026-08-13) and **deployed 2026-08-20**.
This is a genuine regression in capability against the PIN model, which could do
it with a plain RPC, and it is the price of a real auth identity rather than an oversight.

**The organizer loses their own credential (AC 8).** *The answer changed, and this is the change.*
Under the PIN scheme the answer was "a statement run in the Supabase SQL editor by whoever owns the
project" — because there was no address to mail. Under #62 there is: the organizer signs up with a
**real** email, which is required at household creation and is the one account in the household that
cannot be synthetic. So the answer is now **Supabase's own password-reset flow**,
`auth.resetPasswordForEmail`, with no bespoke recovery path and nobody needing dashboard access.

Two things that are deliberately true and worth stating rather than implying:

- **The UI for it is not built.** The mechanism is standard and needs no server, but until a "forgot
  your password" link exists an organizer would have to trigger it from the dashboard. That is a
  smaller gap than the old answer, and it is still a gap.
- **The organizer is still the root.** There is nobody above them to authorise anything; what changed
  is that they can now prove who they are to Supabase instead of to a person with database access.
  That is acceptable for a household app and would not be for anything else.

## Superseded: the PIN decision — 2026-08-06

**Kept for the record. This is no longer what the app does — see *Read this first* above.** Retired
by #62 on 2026-08-11. It is left in full because its reasoning is still the reason the schema has the
shape it has, and because the section immediately below — *why not real per-member auth users* — is
the argument #62 had to answer rather than one it ignored. It answered it by removing the premise:
the Edge Function that was unavailable is now the plan.

**An organizer-set PIN, carried on the member row, checked by the database.**

A device still signs in anonymously and still joins with the household code. On top of that, claiming
a person — saying "this is me" — requires that person's PIN.

### Why not real per-member auth users, which is what "credentials" sounds like

Because an organizer cannot create another person's Supabase auth user from a browser, and this app
has no server:

- `supabase.auth.signUp()` signs the caller in **as the new user**. An organizer creating accounts
  for three children would be signed out of their own after the first.
- `auth.admin.createUser()`, and resetting somebody else's password, both need the **service_role**
  key. That key bypasses row-level security entirely and must never reach a client bundle — this repo
  already fails the build if it does.

So the literal reading of "the organizer creates each member's credential" requires a privileged
server-side component: a Supabase Edge Function holding the service key. That is a real option and it
was rejected **for now**, not on principle — the Supabase CLI is not installed, Docker is not
running, and deploying one is an owner-only step. It is the upgrade path, and it is cheap; see *What
it costs to change later*.

The two alternatives that avoid a server were weighed:

- *Member self-signup with a synthetic email, gated by the join code.* Gives each person a genuine
  Supabase identity with no admin API. Rejected because **password reset still needs admin** — so it
  defers precisely the half of the problem the owner asked to settle, and a forgotten password ends
  in an Edge Function anyway.
- *One shared account.* Loses attribution, which #7 and #12 both depend on. Rejected in the original
  decision and still rejected.

## The honest security level — AC 4

**A PIN is a credential for telling household members apart. It is not a defence against an
attacker.** Stated plainly, because the whole point of writing this down is that nobody later mistakes
it for one:

- **The PIN separates people inside a household. The join code is what keeps strangers out.** Neither
  is strong. A child who reads the join code out on a school bus has given away household access, and
  no PIN changes that.
- **There is no rate limit on `claim_member_with_pin`.** A four-digit PIN is 10,000 possibilities and
  a determined sibling with a script would get through. What makes this tolerable is the threat model
  — the attacker is a nine-year-old who wants to mark someone else's chores done — and what makes it
  *fixable* is that the check is server-side, so a rate limit is a change to one function.
- **What it does buy, and it is not nothing:** the PIN hash is bcrypt and is **never readable by any
  client**, so it cannot be attacked offline; a member cannot set their own PIN, so a child cannot
  lock a parent out; and taking someone's identity now requires their PIN rather than one line of
  JavaScript.

That last clause is not hypothetical. Before migration 0002, `claim_member()` refused a second device
correctly **and a direct `update members set claimed_by` succeeded anyway** — measured against the
live project on 2026-08-06. The guard was real and optional, which is the same as absent.

### The part that is doing the work: column grants

Row-level security decides **which rows**. It has nothing to say about **which columns**, and
Supabase grants `authenticated` every column by default. So every rule expressed as "call this
function" was advisory until 0002 revoked the columns:

- `claimed_by` and `pin_hash` are no longer writable by any client, through any path.
- `pin_hash` is not **readable** either. `select('*')` on `members` now fails outright rather than
  quietly omitting it — which is why the app selects an explicit column list.
- `has_pin` is a generated boolean, granted, because the UI has to know which sign-in to offer
  without being told the secret.

## Credentials for a person with no email, and who resets them — AC 5

- **The identifier is the member row**, not an email address and not a username. Nothing anywhere
  asks a child for an email, because the app never creates an auth user for them — `auth.uid()`
  identifies the *device*, and the PIN proves which *person* that device is acting as. This is the
  main reason the PIN approach was chosen over synthetic-email signup: the honest answer to "what is
  a nine-year-old's identifier?" is *"their name on the roster"*.
- **The organizer sets the PIN**, at household creation for themselves and per person afterwards.
  Enforced by `is_household_organizer()` in the database, not by hiding a button.
- **The organizer resets a forgotten PIN.** There is deliberately **no self-service reset**: there is
  no inbox to send a link to, and a "security question" for a child is theatre. A reset also
  **releases whichever phone is currently acting as that person**, so a forgotten PIN and a phone
  handed on to a sibling are the same operation.
- **The organizer is a person, not a session.** `households.organizer_member_id` points at a member
  row, and a device is the organizer exactly while it is claiming that row. Keying it to `auth.uid()`
  would have quietly disenfranchised the organizer after 30 idle days, when the anonymous session
  expires and returns with a new id — the same trap `members.claimed_by` exists to avoid.
- **The organizer's own PIN cannot be recovered.** They are the root of this scheme; there is nobody
  above them to authorise a reset. The onboarding screen says so at the moment the PIN is chosen.
  Recovering from a lost organizer PIN means a statement run in the Supabase SQL editor by whoever
  owns the project — which is the owner, which is the same person. That is an acceptable answer for a
  household app and would not be for anything else.

## What it costs to change later

**This section was written on 2026-08-06 as a prediction, and #62 is the change it predicted. It is
worth reading against what actually happened, because it was right about the expensive part and
incomplete about the rest** — which is the more useful kind of record than one quietly corrected
after the fact.

Right: no data migration, `members.id` unmoved, `pin_hash` dropped, the whole thing cheap for exactly
the stated reason. What it did not name:

- **Four `security definer` functions carried the old predicate in their bodies** —
  `complete_chore`, `uncomplete_chore`, `assign_chore`, `unassign_chore` all joined
  `household_devices`. A plpgsql body resolves its tables at call time, so dropping the table raised
  nothing and the migration reported success; every one of those actions would have failed on its
  first call in production. Re-pointing policies is visible work and re-pointing function bodies is
  not.
- **Dropping `household_devices` reintroduces the RLS recursion it was accidentally absorbing.** A
  policy on `members` whose predicate subqueries `members` is refused outright by Postgres, so the
  change needs a `security definer` helper it is easy not to see coming.
- **The one-time re-claim is not re-runnable**, and every other file here is. Clearing `claimed_by`
  is correct exactly once; a second paste clears the identities the Edge Function has since written
  and locks the household out with no client-side recovery.

Deliberately little, and the schema is why:

- **Upgrading to real per-member auth users** is an Edge Function plus a sign-in change. No data
  migration: `members.id` is still the durable person and every later story references *that*.
  `pin_hash` becomes dead and is dropped.
- **Adding a rate limit** to `claim_member_with_pin` is a change to one function, because the check
  already happens in the database rather than in the client.
- **Adding a second organizer** is a column change, not a redesign — `organizer_member_id` would
  become a role on the member row.

The thing that would have made all of this expensive is attribution keyed to the auth id, and the
schema deliberately does not do that.

## Superseded: the original decision — 2026-08-05

**Kept for the record. This is no longer what the app does — see *The decision* above.** It is left
here in full because the reasoning still explains the shape of the schema, and because a decision that
was made, acted on and then reversed is worth being able to read.


**A household join code, plus device-level anonymous authentication, plus pick-yourself from the
roster.**

The alternatives, and why they lost:

- *Parent-created credentials per member* — real identity and no session-expiry surprise, but it puts
  a forgotten-password surface in front of a nine-year-old and collects more about each person than
  the app needs. Rejected on friction at exactly the moment five phones are being onboarded.
- *One shared account on every phone* — trivially simple, and it loses attribution. That is not a
  cosmetic loss: the expected-vs-actual story (#12) and the load view (#7) both need to know who did
  what. Cheapest now, most expensive to unpick later.

`docs/hosting-decision.md` had already confirmed the prerequisite this decision rests on — anonymous
sign-ins are on Supabase's free tier and convert to a real account later **keeping the same user id**.
That confirmation was a precondition #5 named explicitly, and it was checked rather than assumed.

## The honest security level — AC 7

**A shared join code is deterrence, not defense.** It is a bearer credential: anyone holding it is in.
It does not expire, it cannot be revoked per-person, and a child who reads it out on a school bus has
given away household access. What it does buy is that household data is not world-readable, which is
a real and sufficient improvement over the shell that preceded it.

Specifically, with the code, an attacker gets read and write access to that household's roster. Without
it they get **nothing** — not an empty household, not a count, not an error that distinguishes "wrong
code" from "no such household". That last point is deliberate: `join_household` raises the same
message either way, because telling a guesser which of the two they hit is free information.

The code is 8 characters from a 30-symbol alphabet — about 6.6 × 10¹¹ combinations — with `0/O`,
`1/I/L` and `U` excluded because they are misread when read aloud. There is **no server-side rate
limit on join attempts** beyond Supabase's platform defaults, so the arithmetic above is the whole of
the protection. If that ever stops being enough, the fix is a rate limit on `join_household` or a code
with an expiry, not a longer code.

**What upgrading to per-member auth would cost later.** Deliberately little, and that is why this was
a safe choice rather than a cheap one:

- Anonymous users **convert in place, keeping the same user id**, so a member who later gets an email
  keeps their history without a migration.
- Nothing in the schema references `auth.uid()` as an identity. `members.id` is the durable person and
  every later story references *that*. `members.claimed_by` is only ever "which device session is
  currently acting as this person".
- So the upgrade is an auth-flow change plus a UI change, and **no data migration**. The one thing that
  would make it expensive — attribution keyed to the auth id — is the thing the schema deliberately
  does not do.

That last point is not tidiness. Anonymous sessions expire after **30 days of inactivity** and the user
comes back with a **new auth id**. A rarely-active family member would silently become a stranger to
their own history if membership were keyed to the auth id, and it would not show up for months.

## How the rules are enforced

Everything is in `supabase/migrations/0001_household_and_roster.sql`. Row-level security is on for all
three tables with no permissive fallback.

- `household_devices` is the root: a session may read its own membership row and nothing else. Every
  other policy reads through it.
- `households` and `members` are visible only to a session that has joined that household.
- A household is a **trust boundary**: inside it, anyone may maintain the roster. There is no
  parent/child distinction, because the charter's bar is a household tool and not an admin console.
- There is **no insert, update or delete policy on `households` or `household_devices` at all**. Those
  rows are created only by `create_household` and `join_household`, which run as definer. A client
  cannot mint a household, forge a membership, or rewrite a join code by any path, because no policy
  exists that would permit it.
- `claim_member` takes `FOR UPDATE` on the member row, so two phones racing to claim the same person
  serialise and the second is refused, rather than both reading "unclaimed" and both writing.

The anon key is inlined into the client bundle at build time and is readable by anyone who views
source. **It is publishable only because these policies exist.** The `service_role` key bypasses RLS
entirely and must never appear in the front end, in git, or behind any `VITE_` variable.

> **This rule was broken, 2026-08-05, and the build now enforces it.** `VITE_SUPABASE_ANON_KEY` in
> Vercel was set to a `sb_secret_…` key — the current-generation equivalent of `service_role` — and it
> shipped into a world-readable preview bundle. Nothing failed, because *nothing can*: a secret key
> bypasses RLS, so the app works perfectly and every policy above is silently void.
>
> The variable lives in a hosting dashboard, outside this repository, so no test, review or grep of
> the codebase could have caught it. `src/lib/keyShape.js` is therefore checked at **build** time from
> `vite.config.js`: a secret key fails the build on the provider's own builder, which is the last
> point at which it can still be stopped. `src/lib/supabase.js` repeats the check at runtime for a dev
> server, where no build happens.
>
> *Proven by making it refuse*: a `sb_secret_…` key and a legacy `service_role` JWT both exit `1`,
> while a `sb_publishable_…` key and an unconfigured build both exit `0` — the last two matter most,
> since a guard that always failed would be indistinguishable from one that works.
>
> **If a secret key has ever been built, rotate it.** Fixing the variable and redeploying does not
> invalidate what was already published.

## The test that bypasses the client — AC 6

`src/test/rls.integration.test.js` talks to Supabase over the wire with the anon key, exactly as a
stranger with the published bundle would. It imports nothing from `src/` except the join-code helper;
going through the app's own data layer would test the app's manners rather than the database's rules.

It is **excluded from `npm test`, and therefore from CI**, because CI has no Supabase credentials. The
exclusion is recorded in three places on purpose — `vite.config.js`, the test file's own header, and
here — so that someone counting the gate's checks does not read four as five.

It is excluded rather than made to skip. A security test that quietly passes when unconfigured is the
same defect `docs/ci-gate.md` exists to prevent, so this one **throws** when the credentials are
missing. *Verified*: `npm run test:rls` without `.env.local` exits `1` with a message naming what is
absent and why the file is not in CI.

It also carries a **positive control** — an assertion that device A, which created the household, can
see its own roster. Without it, every "device B sees nothing" assertion would be satisfied by a
database that returns nothing to anybody, including one with a typo in the table name, and the suite
would read as proof of security.

## Running it

Prerequisites, all in the Supabase dashboard and all the owner's:

1. **Apply the migration.** Paste `supabase/migrations/0001_household_and_roster.sql` into the SQL
   editor and run it. (There is no Supabase CLI on this machine, so there is no `supabase db push`.)
2. **Enable anonymous sign-ins** — Authentication → Providers → Anonymous. This is **off by default**,
   and with it off every test fails at sign-in with an error that does not obviously say so.
3. Put the project URL and **anon** key in `.env.local` at the repo root (gitignored):

   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```

Then `npm run test:rls`.

**Anonymous sign-in is rate-limited to 30 requests/hour per IP.** Each run creates two anonymous users,
so roughly fifteen runs an hour from one network — and a whole household shares one home IP. The test
detects this case and says so, because otherwise it presents as a policy failure in your own code.

**Cleanup.** Each run leaves one household named `TEST <timestamp>` and two anonymous users. There is
deliberately no client-reachable way to delete a household, so tidying is a manual statement in the SQL
editor:

```sql
delete from public.households where name like 'TEST %';
```

## What is not done

### Correction, 2026-08-09 — this section was wrong in both directions at once

**Every migration below is now applied.** The entries are kept because their *reasoning* is still
the best record of what each file does and why; only their status claims were wrong. Read them for
the design, never for what the live project has.

What happened: pasting `0006` at the merge of #36 was rejected with
`ERROR: 42P01: relation "public.chores" does not exist`. **`0003` and `0004` had never been
applied**, though #34 and #35 merged on 2026-08-08 and deployed client code that reads those tables.
For a day the live app could not hold a household at all — `refresh()` calls `listChores()` whenever
one is found, so a joined device failed at boot and creating a household failed immediately. All
three were then applied in order: `0003`, `0004`, `0006`.

Meanwhile the `0005` entry claimed the opposite of the truth: it had been live since #45, and
applied cleanly without `chores` existing because it only touches `households`, `members` and
`member_capacity`.

**So this page was right about two migrations, wrong about one, and load-bearing for neither** —
nothing reads it. That is the actual defect, and it is filed as
[#78](https://github.com/SailorDave17/Taskr/issues/78): a required deploy step performed by a human,
recorded only in prose, and compared against nothing. Note why no test caught it — the pglite
harness applies every file in `supabase/migrations/` **from disk**, so a green suite proves the
schema is right in the one environment where it cannot be wrong, and `npm run test:rls`, the only
thing that goes over the wire, contains zero references to `chores`.

**#78 landed 2026-08-10, and the authority moved off this page.** `npm run check:live` probes every
table and column the client reads, using the same column constants the queries use, and fails naming
the missing object — `42P01` for a table a migration never created, `42703` for a column `0004` or
`0006` would have added, `42501` for something present that this role may not read. It reads schema
and never data (`limit(0)`), so it is safe to run against production at any time, and it refuses a
secret key, which would answer a different question with broader grants.

One limit remains, stated rather than discovered later: it is **not run by CI** — CI has no
credentials, and a check that skips itself when unconfigured is the vacuous pass this whole story is
about — so it is a step a human runs after pasting a migration. The *list* it works from is guarded
in CI by `src/lib/liveSchema.test.js`, which fails when the app reads a table the list does not name.

**The second limit closed with #85, 2026-08-16.** It used to cover *tables, not functions* — `0006`
adds `assign_chore` and `unassign_chore` as well as a column, so a migration that added only an RPC
would pass the check while the app failed. `check:live` now probes the five RPCs the client calls as
well, **by their argument names**, because PostgREST resolves an overload by the set of argument
names rather than by position: `create_household(household_name, organizer_name,
household_timezone)` and `create_household(household_name, household_tz, organizer_name,
organizer_pin)` are two different functions to it. Until the `0007` paste on 2026-08-20 only the
second was on the live project while the client called the first — which is precisely the divergence
this probe was built to catch, and it caught it on its first run.

How a function is probed without calling it is the part worth carrying: the probe is a **GET**, and
PostgREST serves a GET inside a **read-only transaction**. All five of these RPCs write, so Postgres
refuses the write and answers `25006` — which proves the function resolved *and* proves nothing
changed, in one round trip. It is the function-shaped equivalent of `limit(0)`, and the check asserts
that read-only behaviour with a control of its own rather than trusting it. A `PGRST202` is the
failure: PostgREST answered from its schema cache, so the function was never resolved.

#85 was filed naming **nine** RPCs and the answer is **five**. That is not a narrowing: `0007` drops
`claim_member`, `claim_member_with_pin`, `set_member_pin` and `join_household`, and the client
stopped calling them at #62 — so probing for them would make the check red against a *fully migrated*
project, which is the `household_devices` mistake in the other direction.

This section remains a **reasoning record, not a status report** - read the entries below for what each migration does and why, and `npm run check:live` for what the project actually has.

### Updated 2026-08-09 — story #36 added a sixth migration

**`0006_chore_assignment.sql` was applied 2026-08-09**, at the merge of #36, third of the three
pasted that day. It had to go last: it alters the table `0003` creates. Its paste also settled a
question no local test could — **Supabase accepts `on delete set null (assigned_member_id)`**, the
Postgres 15+ column-list form, which until then was proven only against PGlite 18.

Pasting it mattered for the same
reason 0003 and 0004 must be: the merge deploys client code that reads `assigned_member_id`, the
chore read shares `refresh()` with the roster, and a column a `select` list names but the project
does not have fails the whole shell rather than just the chore list.

What it adds, and the two decisions worth knowing before pasting:

- **`assigned_member_id` is readable and NOT writable**, arriving withheld rather than revoked from a
  shipped write path. It moves only through `assign_chore()` / `unassign_chore()`. This is the third
  application of 0003's additive-by-column convention and the reasoning has not changed: a
  client-writable assignment column makes the eligibility rule (#37), the churn bound (#41) and every
  allocator invariant (#40, #49) advisory rather than enforceable.
- **The same-household rule is a CONSTRAINT, not only a function check** — and this is the first
  migration here to do that. The foreign key is composite,
  `(assigned_member_id, household_id) → members (id, household_id)`, so a chore in one household
  cannot name a member of another even for a caller who bypasses the function entirely. That is this
  page's own central lesson applied to itself: *a rule enforced only inside a function you provide is
  enforced only for clients that choose to call it.* `assign_chore` still refuses first, because AC 1
  wants a sentence rather than a constraint violation; the constraint is what keeps the rule true if
  the function is later edited wrongly.
- **`on delete set null (assigned_member_id)` names its column, and the clause is load-bearing.** A
  bare `on delete set null` on a composite key nulls *every* referencing column, and `household_id`
  is `not null` — so removing a member would fail with a constraint violation instead of releasing
  their chores, which is the exact inverse of what #36 AC 7 asks for. *Measured* by mutation:
  dropping the column list reddens AC 7 and nothing else. Postgres 15+, which both PGlite 18 and
  Supabase satisfy.
- **Nothing is stored.** Committed and remaining minutes are summed at read time in
  `src/lib/chores.js`; the migration adds one column holding the allocation and no counter. A
  `members.committed_minutes` would be two sources for one quantity and they would disagree the first
  time a chore was completed on another phone — so the suite asserts the *absence* of any such column
  across the whole `public` schema, not merely the presence of the sum.

### Updated 2026-08-08 — story #35 added a fourth migration

**`0004_chore_completion.sql` was applied 2026-08-09** — *four days after the merge of #35, not at
it*, which is half of the outage described in the correction above. Second of the three pasted that
day. It had to be pasted for the same
reason 0003 must be — the merge deploys client code that reads `completed_at`, and the chore read
shares `refresh()` with the roster, so the whole shell fails rather than just the chore list.

What it adds, and the one non-obvious decision:

- **`completed_at` and `completed_by_member_id` are readable and NOT writable.** They move only
  through `complete_chore()` / `uncomplete_chore()`, and the withholding is in place from the first
  moment the columns exist rather than revoked from a shipped write path later.
- **The definer function is about the CLOCK, not access control.** A household is already a trust
  boundary, so the function buys no authorization it did not have. What it buys is `now()` being the
  *database's*: `completed_at` decides which week work falls in, and a phone with a wrong date would
  move work between weeks silently. That is a foreign input to the fairness arithmetic.
- **Attribution is to `members.id`, never `auth.uid()`** — the invariant 0001 sets. An idle
  anonymous session returns after 30 days with a new auth id.
- **Completing an unassigned chore is allowed and attributed** (owner decision, 2026-08-08). It is
  the noticing dimension's first contact with data; nothing surfaces it, and whether it ever becomes
  a product feature stays open.

### Updated 2026-08-08 — story #34 added a third migration

**`0003_chores.sql` was applied 2026-08-09** — *five days after the merge of #34*, and it is the
missing one that broke the live app. First of the three pasted that day. It creates `chores`, the
fourth RLS-protected table, and the instruction below was correct and was not followed: it must be
pasted into the Supabase SQL editor **at the merge of #34, not afterwards** —
the merge deploys client code that queries a table the live project does not have, and the failure
is total rather than confined to the chore list, because the chore read sits in the same `refresh()`
chain as the roster. Nothing in the repo enforces this; that is why it is written here, on the page
that lists what is outstanding, rather than only in the issue.

It follows 0002's revoke-then-grant-per-column shape and adds two things worth knowing:

- **`household_id` is withheld from the select grant**, which is what makes `select('*')` fail on
  this table. *Measured*: with every column granted the wildcard succeeds, so a table whose every
  column is readable has the ceremony and none of the effect. A withheld column is also absent from
  `WHERE` and `ORDER BY`, not just the projection — fine here, because RLS is the filter.
- **`anon` is revoked wholesale** (`revoke all`), not column by column. An earlier draft revoked only
  select/insert/update and left DELETE, TRUNCATE and TRIGGER granted by Supabase's defaults; neither
  was reachable through the publishable key, but the DELETE grant would have gone live the moment a
  later story added a `to anon` policy. `authenticated` keeps DELETE, which its policy needs.

The convention #35, #36 and #37 inherit: each migration grants UPDATE only on the columns it makes
client-editable, so `assigned_member_id` and `completed_at` do not exist yet.

### Updated 2026-08-06 — story #23, and what is left

`0001` **is** applied and anonymous sign-ins **are** on; the sentence below about "the migration has
not been applied" is about 0001 and is now historical. What is outstanding is narrower:

- **`0002_member_pins_and_column_grants.sql` — now applied**, verified live by PR #65's suite; the
  rest of this bullet is historical. It is re-runnable, and a test asserts that it is, because a re-paste after a partial failure
  is the normal way this file gets used.
- **It changes `create_household`'s signature** from one argument to three, and drops the old form
  deliberately — a household created without an organizer cannot be administered at all. So the
  deployed bundle and the database must move together: applying 0002 breaks the currently-deployed
  app until this PR's build is live, and vice versa. On a household app with no users yet that is a
  non-event; it will not be later. **0005 takes it to four**, adding the household timezone with a
  default, so that fourth argument is the one signature change so far that does *not* break an older
  bundle — a three-argument call still resolves.

- **`0005_weekly_capacity.sql` was applied at #45**, and this entry claimed otherwise until
  2026-08-09 — the wrong direction of the same defect. #45 owns the paste and proving the rules over
  the wire, and did both. It adds `member_capacity` — a
  per-member, per-week override on top of the `members.weekly_minutes` baseline — plus
  `households.timezone`. Three things about it are worth knowing before pasting:

  - **The week begins on Monday**, enforced by a check constraint rather than left to convention, so
    a row filed under any other weekday cannot exist. Reasoning in
    [`capacity-model.md`](capacity-model.md).
  - **`household_id` is withheld from the select grant**, same convention as `chores` in 0003 — which
    also means it cannot appear in a `WHERE` clause, because Postgres requires `SELECT` on any column
    named in a predicate and reports the refusal as *"permission denied for table"*.
  - **`households` gains its first `UPDATE` policy**, so that surface is column-granted to
    `name, timezone` only. Without that bound, any member could rewrite `join_code` or reassign
    `organizer_member_id` — the hole 0002 measured, reopened. **`SELECT` on `households` is
    deliberately left un-granted-per-column**: `currentHousehold()` issues `select('*')`, which a
    column grant makes fail outright.
- **The existing test households are unusable under 0002.** They have no `organizer_member_id`, so
  `is_household_organizer()` returns false for them and no PIN can ever be set. They are `TEST …` rows
  and the cleanup statement in *Running it* removes them.
- **Nothing here has been verified on two real phones.** That is #26, deliberately.

Unlike the previous rounds, the SQL in this story **has** been executed before being handed over —
`src/test/migrations.pglite.test.js` runs 0001 and 0002 against Postgres 18 in WASM, with 22
assertions and a mutation record, and `src/test/chores.pglite.test.js` does the same for 0003. That proves it is correct Postgres and that the rules hold; it does
not prove Supabase will accept it, and the stub it runs against is listed in
`src/test/support/pgliteSupabase.js` so the gap is inspectable.

### Historical — written at PR 1 of story #5

- **The migration has not been applied to the live project**, so none of the policies above have been
  exercised against a real Postgres. The SQL is unvalidated in the strict sense: there is no local
  Postgres, no Supabase CLI and no running Docker daemon on this machine, so nothing has parsed it.
  Applying it in the dashboard both validates it and unblocks the test — one action, and it is the
  reason this PR ticks no acceptance criteria.
- ACs 1–5 are PRs 2 and 3 of this story: the roster UI, persistence across restarts, and the join flow
  verified on two real phones.

### Updated 2026-08-05 — PR 2 (the roster UI) has landed

The client half of ACs 1–5 is now built: `src/lib/household.js` plus `src/components/Onboarding.jsx`
and `src/components/Roster.jsx`, with 100 unit and component tests (was 30) and five mutations each
reddening exactly the predicted test.

**No acceptance criterion is ticked by that PR either, and the reason has not changed.** Both prerequisites
above are still outstanding, so nothing in this story has run against a real database:

- the migration is still unapplied, so the policies remain unparsed;
- anonymous sign-ins are still off, so no device can obtain a session at all.

Until both are done, every ACs 1–6 check fails at the first round trip. What the tests above *do*
establish is narrower and worth stating precisely: the app asks the right questions, refuses the
obviously wrong ones before spending a round trip, and reads the roster from the server rather than
from device storage. **None of that is evidence about the access rules** — a fake client returns
whatever the test told it to. AC 6 is `src/test/rls.integration.test.js` and nothing else.

One client-side design note that belongs here rather than in a commit message: the app holds the
Supabase **auth session** locally and nothing else. That session is the credential, which is what
makes AC 5's "stays joined days later without re-entering the code" true; the household and roster are
re-read from the server on every load, so a device that merely *remembered* would be indistinguishable
from one that is genuinely still joined — and AC 3 is precisely the check that would be fooled.
- **Preview deployments are login-gated** — Vercel Authentication is set to *Standard Protection*,
  applied 2026-08-21 by #121. A preview URL now answers `302` to `vercel.com/sso-api` and lands on
  `vercel.com/login`; an unauthenticated stranger cannot load the app, and cannot fetch its bundle
  either. Until then previews were world-readable while carrying the PRODUCTION Supabase host, which
  is what made a preview a second front door onto the live database rather than a sandbox, and is the
  surface #19 decided to close.

  **What Standard Protection exempts is the production *domains*, not production deployments** —
  measured 2026-08-21 on uncached paths, in the same second: `taskr.madcowhq.com` and the assigned
  `taskr-khaki.vercel.app` both reach the app, while **every** per-deployment `*.vercel.app` URL
  redirects to login, the production deployment's own URL included. #121 was filed expecting the
  assigned domain to be gated too, on the strength of Vercel's documented wording; it is not. Nobody
  was locked out and no re-install was forced.

  This gates the client, not the data. It removes an unwatched surface and changes nothing about who
  can read a row: the policies on this page held the line before it and remain the whole defence
  after it.
