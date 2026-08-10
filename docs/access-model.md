# Access model — how a household joins, and what that actually protects

- Date: 2026-08-05, **substantially revised 2026-08-06**
- Decided by: owner (SailorDave17), at pickup of story #5, then overridden at pickup of story #23
- Story: #5 (schema, policies, the bypass test), #23 (per-member credentials, column grants),
  #34 (chores, which inherits the column-grant convention) and #36 (assignment, which is the first
  to make the convention's rule structural as well as procedural)
- Status: **decided and implemented. All six migrations are applied to the live project as of
  2026-08-09** — `0001`/`0002` long since, `0005` at #45, and `0003`/`0004`/`0006` pasted in that
  order on 2026-08-09 at the merge of #36. `0002` is verified over the wire by the live RLS suite
  (PR #65, 13/13 against the real project); the rest are verified only by the paste succeeding.
- **This page is prose about live state and prose is what failed here** — see the correction at the
  head of *What is not done*. Since #78 the authority is a **check, not this page**: run
  `npm run check:live` and believe its output. What is written here is the *reasoning* — why each
  migration exists and what it grants — which is the half a check cannot carry.

## Read this first — the decision below changed

The original decision on this page was **a household join code plus anonymous auth, pick yourself
from the roster**. The owner overrode it on 2026-08-05 in favour of **per-member credentials**. That
older decision is kept further down, under *Superseded: the original decision*, because knowing what
was believed and abandoned is worth having — but it is no longer what the app does.

The join code still exists. What changed is what it means: it is now only how a **device** gets into
the household. It is no longer how a **person** is identified.

## The decision — 2026-08-06

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

Two limits, stated rather than discovered later. It is **not run by CI** — CI has no credentials, and
a check that skips itself when unconfigured is the vacuous pass this whole story is about — so it is
a step a human runs after pasting a migration. And it covers **tables, not functions**: `0006` added
`assign_chore` and `unassign_chore`, and a migration that adds only an RPC would pass this check
while the app failed. The *list* it works from is guarded in CI by `src/lib/liveSchema.test.js`,
which fails when the app reads a table the list does not name.

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
- **Preview deployments are world-readable** (Vercel Authentication is off project-wide), so once real
  data exists this file's assumptions interact with #19. Nothing here decides that; #19 does.
