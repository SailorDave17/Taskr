# Access model — how a household joins, and what that actually protects

- Date: 2026-08-05
- Decided by: owner (SailorDave17), at pickup of story #5
- Story: #5 (PR 1 of 3 — schema, policies, and the test that bypasses the client)
- Status: **decided and implemented; not yet applied to the live project.** See *What is not done*.

## The decision

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

- **The migration has not been applied to the live project**, so none of the policies above have been
  exercised against a real Postgres. The SQL is unvalidated in the strict sense: there is no local
  Postgres, no Supabase CLI and no running Docker daemon on this machine, so nothing has parsed it.
  Applying it in the dashboard both validates it and unblocks the test — one action, and it is the
  reason this PR ticks no acceptance criteria.
- ACs 1–5 are PRs 2 and 3 of this story: the roster UI, persistence across restarts, and the join flow
  verified on two real phones.
- **Preview deployments are world-readable** (Vercel Authentication is off project-wide), so once real
  data exists this file's assumptions interact with #19. Nothing here decides that; #19 does.
