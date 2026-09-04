# Taskr

Household chores get allocated by nagging, habit, or an "even split" that isn't actually even. Taskr
allocates them **fairly by time**: chores are minutes of work, people are budgets of available
minutes, and the assignment is proportional to each member's real capacity — then it puts everyone's
load on one screen, so the fairness is *seen* rather than asserted.

It is built for a household with unequal capacities. A kid with 60 available minutes and a parent
with 300 should not get the same number of chores.

The bar it is built to is **phone-usable for a real household**: it runs on family members' phones,
data survives restarts, and nothing depends on a laptop being switched on. See
[`docs/refresh-charter.md`](docs/refresh-charter.md) for the full contract, including what must
survive and what was deliberately thrown away.

## Status

This is a **rebuild in progress**, tracked by epic
[#2](https://github.com/SailorDave17/Taskr/issues/2). Rank the remaining work from the tracker, not
from this file.

**What is live today**: an installable page where a household is created, people are added with
their weekly available minutes **and their email address**, each person signs in on their own phone
with that address and an organizer-set PIN, typed into the password box,
and the household's chores are recorded as titled units of expected minutes with a due date. Chores can be marked done and
un-done, with the completion moment stamped by the database's clock rather than the phone's, so a
phone with the wrong date cannot move work between weeks. Each chore can be **given to a person**.

The app opens on **the split**: each member's load drawn as a share of *their own* capacity, so
level bars mean a fair division whatever the capacities are — a parent at 150 of 300 minutes and a
child at 30 of 60 are level, and it is visible without reading a number. Above the bars is the
verdict in minutes: level, or how many minutes off it the household is, or — when the smallest job
is too big for the smallest budget — that level cannot be reached this week and why. Work nobody
holds sits in its own needs-attention area rather than vanishing from the arithmetic. Members are in
roster order, never sorted by load: **ranking people by output is the exact inversion of the
thesis**. The roster and the chore list are two taps away, and everything is derived at read time
rather than stored. It
persists to Supabase — data survives a restart, a reinstall and a redeploy, because it is in a
hosted database rather than on the device.

**What protects it is server-side.** Row-level security policies and column-level grants, in
`supabase/migrations/`, asserted by tests that bypass the client. A client-side guard is not a guard,
and the reasoning — including the honest statement of what the access model does *not* protect
against — is [`docs/access-model.md`](docs/access-model.md). Read that before touching the data
layer.

**`0007` and `0008` were pasted to the live project on 2026-08-20** ([#108](https://github.com/SailorDave17/Taskr/issues/108)),
so the database is now on per-member auth. `npm run check:live` read **20 of 20** that day —
every table, every RPC, and the `provision-member` Edge Function, which was deployed on
2026-08-20 (#112) with `npm run deploy:function`.

**`0009` was pasted on 2026-08-21, `0010` and `0011` on 2026-08-24**, and all three are verified over
the wire rather than on the strength of a paste having been reported — by two different instruments,
because one of them cannot see `0009` at all.

`0011`: `calendar_connections` resolves for an authenticated caller with exactly the four granted
columns and answers `42501 permission denied` to `anon`, which is the grant in `0011` doing what it
says. `0010`: `chore_exclusions` answers with its four granted columns, and that assertion was **red
by design until the paste**. Both are `npm run check:live`. `0009` is confirmed by a **different
instrument**, and the difference is a property of the migrations rather than of the check:

- `0009` changes only two indexes, and `check:live` covers tables, columns, RPCs and Edge Functions
  — so it is **structurally blind to it** and stays green either way. Do not read that green as
  "the database matches the repo". What confirms it is **`npm run test:rls`**, which cannot even
  reach its first assertion unless `0009` is applied: `beforeAll` puts one seeded account in two
  households, which the pre-`0009` global `members_claimed_by_key` forbids. *Measured 2026-08-24:
  31 of 31, no skips; re-measured 2026-08-28 at **65 of 65**, after #221 restored the seeded
  account and #38 added eight chore cases.* **A suite that fails at setup under the old schema is a stronger presence
  check than any probe** — it cannot pass for the wrong reason.
- `0010` creates a table the client reads, so the check **can** see it, and it was **red on it by
  design** from the merge until the paste.
- `0011` creates **two** tables and the check asks about **one** of them, deliberately.
  `calendar_connections` is read by the client, so the check sees it; `calendar_tokens` holds a
  Google refresh token, the client is granted nothing on it at all, and probing it would report a
  missing grant on a perfectly healthy project.

**`calendar-connect`, the Edge Function `0011` exists for, has been deployed**, and it needed its
own action: an Edge Function arrives with `npm run deploy:function` and **no migration carries it**,
so pasting `0011` did not and could not clear it. That red survived the `0011` paste exactly as
[`docs/access-model.md`](docs/access-model.md) predicted it would, and cleared on the deploy.

*Measured 2026-08-24, after both actions*: the run read **23 of 23** with the excused-red set
**EMPTY**. Later the same day #53 put `0012` (repeating chores) into the repo, taking the run to a
measured **22 of 24** with two expected reds — and ***`0012` was pasted that same evening***, so the
run read a *measured* **24 of 24** with the set empty again. Both reds cleared on
exactly the action they named and on nothing else. The set has inverted twice more since: #159/#150
(2026-08-26, two reds until `0014` was pasted the same afternoon), and #12 later that day, which
opened ONE expected red — `chores` refusing `actual_minutes` — cleared when `0015` was pasted
(#194) that evening. `0016` (#152) did NOT invert it: a migration made only
of an RLS policy has no probe here that could go red, so the set stayed EMPTY on both sides of that
paste and the paste is confirmed by the catalog instead (#198). It inverted twice more on
2026-08-27, when #49 merged with `0018` unapplied — TWO reds at a *measured* **23 of 25**, the
denominator having moved to 25 because #49 added the `apply_assignments` probe — and back to EMPTY
when `0018` was applied under #231. #50 inverted it twice more in one session: `member_split_seen`
(the announcement's per-member seen-marker, `0020`) stood at a *measured* **25 of 26**, and
`npm run migrate:live` drained it the same hour — *measured* **26 of 26**, with
`npm run probe:live-grants` agreeing from the catalog side. The denominator then moved to **28**
without the set inverting at all: #250 added two rows that ask about the SEEDED ACCOUNT rather than
about the project, so nothing became excusable and the count moved for the first time on something a
migration cannot change. #211 then inverted it once more inside a single session: adding
`chores.source` to what the client reads took it to a *measured* **27 of 28**, `chores` answering
`42703` on the new column, and `npm run migrate:live` applying `0023` took it straight back —
*measured* **28 of 28**, both readings taken rather than one reasoned from the other. #105 then
repeated that both-sides discipline: adding the exception table and the skip RPC to what the check
asks took it to a *measured* **28 of 30**, and `npm run migrate:live` applying `0025` took it
straight back — *measured* **30 of 30** the same hour, both reds clearing on exactly that action.
#305 then did it with THREE: `missed_at` joined the chores column list and `miss_chore` /
`unmiss_chore` the RPC list, a *measured* **29 of 32** before `npm run migrate:live` applied
`0027` and **32 of 32** after, in the story's own session. #306 then applied `0028` in its own
session and the set did NOT invert, because it could not: that file replaces the body of
`catch_up_repeats_at` and nothing else, and this check probes a function by name and argument set
— a *measured* **32 of 32** on both sides of the apply, with a read-only `pg_get_functiondef`
over the Management API the instrument that separates them (the supersede step absent before,
present after). #307 then did the same with `0029`, blind for a **different** reason — a constraint
widened and two function bodies replaced, none of which is a table, a column or a signature — a
*measured* **32 of 32** on both sides again, with a read-only catalog query separating them (the
constraint at two values before and three after, neither function's body mentioning
`assigned_source` before and both after) and `npm run probe:live-grants` at **15 of 15** on both
sides, which is what makes that file's "it issues no privilege statement" a measurement rather than
a claim.
**Where it stands: TWO rows are excused, both added by #96 and both draining on one action each.**
`0030` creates `calendar_busy` and the client reads it, so that table's probe answers `PGRST205`
until the migration is applied; `calendar-busy` is an Edge Function, so its probe stays red until
`npm run deploy:function` puts it there. Two artefacts, two actions, two reds — the same pair `0011`
opened for #95, and, as this file recorded then, **a paste clears only its own**. Every other red, on
any other subject, is real. Before #96 the set was EMPTY, *measured* at 32 of 32 on 2026-09-02.

[`docs/access-model.md`](docs/access-model.md) carries the excused-red table — two rows since #96,
`calendar_busy` and `calendar-busy`, the first entries since `0020`'s drained; `0023`'s row never
stood at all because #211 applied it in its own session, as #59 did for `0021` and #50 for `0020` —
and
the history of the fifteen times that set has been inverted, which is the
record worth keeping: an empty set is the state in which the check is worth the most, and every
entry added to it is a claim that has to be cleared by a named action.

*The two sentences above the link said "EMPTY again … the history of the eight times" until
2026-08-26 — present-tense claims that survived two inversions, because the sweeps that moved the
table cell in the scripts section and the table in access-model.md stopped there. This paragraph is
the third home of that claim, and it is the one a new reader meets first.*

**Production serves per-member auth too, since the same day.** `rebuild/v1` was promoted to `release`
by [#111](https://github.com/SailorDave17/Taskr/pull/111), and Vercel builds production from
`release`. That split is still the point and still how anything reaches a phone — see *Branches*
below.

*This paragraph was followed by two bullets headed "Two things are deliberately still true after that
paste" until 2026-08-21, and by then neither was: production had been promoted, and the Edge Function
had been deployed — **eight lines under a sentence in this same paragraph saying it was deployed on
2026-08-20**. Both bullets were written before that day's work and were correct for a few hours. The
lesson is not that a README goes stale; it is that the correcting edit landed in the paragraph
directly above and stopped there, so the section a new reader opens to learn what is missing was the
one still describing a system that no longer exists.*

**Migrations are applied deliberately, by a person, and nothing checks that they were.** Each file
in `supabase/migrations/` reaches the live project at the merge of the story that adds it, by one of
two routes: pasted into the Supabase SQL editor, or applied with `npm run migrate:live <file>`
(#185). [`docs/deploy-runbook.md`](docs/deploy-runbook.md) section 5 carries both and the condition
each is for — the editor needs a signed-in browser and suits an attended session; the command takes
a token and is the only one that runs unattended. *The reason recorded here used to be "there is no
Supabase CLI or Docker on the build machine". Both are available as of 2026-08-20 - the CLI through
`npx`, Docker running - so that reason had outlived its cause well before either route existed.*
They are re-runnable and a test proves it, because a re-paste after a partial failure is the normal
path — re-applied **in order**. A single older file re-pasted on its own onto today's schema is not
always: [`docs/access-model.md`](docs/access-model.md)'s re-runnability section names which files
carry a function body a later file replaced (today `0012`, `0025` and `0026`, whose
`catch_up_repeats_at` `0028` superseded, and `0027` and `0007`, whose `complete_chore` and
`uncomplete_chore` `0029` superseded), and re-pasting one of those alone reverts that function while
reporting success.

**What is still not automated, and deliberately: applying a migration is not coupled to a merge.**
Both routes are a separate act somebody chooses, in a stated order — apply, then promote
`develop` to `release`. #185 gave the paste a command; it did not give it a trigger. *That
distinction is the whole reason this paragraph survives: coupling a merge to a schema change is a
real decision rather than a tidy-up, and it has not been taken. The 2026-08-09 outage in
[`docs/access-model.md`](docs/access-model.md) is what happens when the two are coupled the other
way round.*

*Two were missed, and the live app could not hold a household for a day before an unrelated paste
found it (2026-08-09).* `docs/access-model.md` records which are live and **was wrong in both
directions** when this was discovered, so read it for the reasoning and treat the dashboard as the
authority. Closing that gap is [#78](https://github.com/SailorDave17/Taskr/issues/78) — the pglite
suite applies every migration from disk, so a green CI run says nothing whatsoever about the live
project.

**The engine is half-wired.** The allocator (#40) divides work by capacity and says plainly when
level is unreachable, judged against a 13-shape corpus; per-week capacity (#44) makes a person's
minutes a fact about *this* week rather than a standing number. #36 connected the first of the two:
the load figures resolve capacity through `capacity.js`, so a week override changes the numbers on
screen as soon as a week override is set, which #46 does. **The allocator has a reader but no
writer** — #47's split screen calls `allocate` to ask whether level is reachable at all, and it is
the first screen a joined household sees, but nothing on a phone divides the work automatically:
no code path assigns a chore from the allocator's answer, which is the thing the app is ultimately
for (#49). #41's `reallocate` has no caller at all yet.

That is where the next work goes: re-assigning the household's open chores from current capacity is
#49. Setting a week's capacity by hand shipped as #46 on 2026-08-09, and showing the split as a share
of each person's own capacity shipped as #47 on 2026-08-25 — the split screen described above is
#47's. What it replaced was `Commitment` on the chore screen, which #36 had shipped deliberately as
the ugliest honest form, plain minutes with no bar and no percentage, because the charter's test is
that a proposal satisfiable by a screenshot of the 2020 all-users view has collapsed.

The 2020 classroom original is preserved at tag `legacy-final` and is not the code in this branch.

## Where it runs

**<https://taskr.madcowhq.com>**

That is the custom production domain, added 2026-08-21 by #121, and the one to publish and to test
against. The assigned `taskr-khaki.vercel.app` still resolves and serves the same build — Standard
Protection does not gate it, so an install made from it keeps working and nobody has to move in a
hurry — but the custom domain is the published one. Vercel also answers on a `<project>-<account>`
alias, which is neither and is deliberately not named here; none of the three is guaranteed to stay
pointed at the same deployment.

**To confirm which commit the live site is serving, read the page footer.** It ends with
`build <sha>`, mapped from the host's commit SHA into the bundle at build time. A deployment
dashboard answers about the deployment you asked it about, not about what the URL currently
resolves to — the footer answers the actual question. It reads `build local` when running from a
dev server.

## Running it locally

Requires **Node 22** (the version CI uses).

```bash
npm ci        # install exactly what the lockfile pins
npm run dev   # dev server, prints its own localhost URL
```

Other scripts:

| Command | What it does |
|---|---|
| `npm run lint` | ESLint over the repo |
| `npm test` | Vitest, single run. Fails on zero tests, deliberately |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run icons` | Regenerate the PWA icons from `scripts/generate-icons.mjs` |
| `npm run allocation:corpus` | Re-derive the allocation corpus figures recorded in [`docs/allocation-corpus.md`](docs/allocation-corpus.md) — how many household shapes reach level, and how many cannot |
| `npm run extraction:corpus` | Re-derive the extraction corpus figures recorded in [`docs/extraction-corpus.md`](docs/extraction-corpus.md) — the shape of the sixty plain-language descriptions, and the floor and ceiling the two control extractors reach. Grades the controls only — a real extractor is graded by `extraction:run` — so what it prints is the SCALE a later score is read against, and it stays runnable if the adapter is deleted (#203 AC 8: a stop verdict must not take the instrument with it). No network call, no API key, no provider account |
| `npm run extraction:run` | **Grade the corpus through the real provider adapter** (#203) — the same grader and the same report rows as `extraction:corpus`, labelled by which configuration (model, effort, prompt) produced which figures. Two modes, one pipe: `-- --record <file>` runs LIVE against Anthropic — owner-only, needs `ANTHROPIC_API_KEY` in the environment, bills the account, and writes every response into a transcript as it grades — and `-- --transcript <file>` replays a recorded transcript with no network and no key, so a recorded run's figures are re-derivable by anyone, like every other corpus figure here. A transcript that does not cover the corpus REFUSES the whole report rather than grading the holes as transport failures. The key is sent in one header and stored nowhere — not in the transcript, not in the report. #206 is the story that runs it live at two configurations and records the verdict inputs |
| `npm run rebalance:corpus` | Re-derive the churn figures recorded in [`docs/rebalance-churn.md`](docs/rebalance-churn.md) — how much of a household’s list a re-balance moves with no stability rule at all, and the table of change budget against minutes moved against levelness reached that set `CHANGE_BUDGET_MINUTES`. Pure arithmetic over the committed corpus: no network, no database |
| `npm run test:rls` | The live row-level-security suite. Goes over the wire to the real Supabase project, so it needs `.env.local` and the migrations applied. **Not run by CI** — it is excluded there deliberately, because a security test that quietly passes when unconfigured is the same defect as a gate with no tests in it. **It is also the only instrument that can confirm `0009`**, and it does so at *setup* rather than in an assertion: `beforeAll` puts one seeded account in two households, which the pre-`0009` global `members_claimed_by_key` forbids, so the suite cannot reach its first assertion against an unmigrated project. **It also needs the seeded account behind `TASKR_TEST_EMAIL` to exist** — that is a third precondition, and it is the one with no error of its own. *Measured 2026-08-28 at 65 of 65, after #38 added eight chore cases; it read 57 of 57 earlier the same day.* The count moved because tests were added, not because any were removed: it read **31 of 31 on 2026-08-24**, and that figure stood in this cell while the suite was DEAD. The seeded account was cleared around **2026-08-25** and the suite could not reach its first assertion until it was restored on **2026-08-28** (#221) — so for four days this row described an instrument that could not run, and nothing recorded when that started. It fails in the shape that reads as an environment hiccup: a vitest `beforeAll` failure is reported as tests SKIPPED, so the run exits non-zero with `numFailedTests: 0` and nothing named as failing. **Two of its own tests went stale inside that window** and were only caught by the restored run — one rewritten by #159 on 2026-08-26 and never once executed, one falsified by `0016` the same day — which is the argument for treating a dead instrument as urgent rather than untidy: it stops reporting AND lets its subject drift. It writes to the live project by design and leaves households behind — there is no client-reachable delete — so run it with that in mind, and see [`docs/access-model.md`](docs/access-model.md) for what a tidy-up must SPARE |
| `npm run test:functions` | **The provisioning Edge Function, against a real stack.** `provision-member` only — `calendar-connect`'s decisions are unit-tested in `npm test` with an injected `fetch`, because its subject is what GOOGLE does and there is no local Google to point a stack at. Needs Docker: `npx supabase start` and `npx supabase functions serve --no-verify-jwt`. **Not run by CI** — it needs Postgres, GoTrue and a `service_role` key, and it targets the LOCAL stack, never the hosted project, because provisioning creates auth users. Loud rather than skipped: it fails with instructions when the stack is down |
| `npm run deploy:function` | **Deploy this repo's Edge Functions to the hosted project** — `provision-member`, `calendar-connect` (#95) and `calendar-busy` (#96). All of them by default, because the safe and complete action should be the one with the least typing; `npm run deploy:function -- <name>` narrows it, and an unknown name is refused here rather than handed to the CLI. Owner-only: it needs a Supabase access token (`npx supabase login`, or `SUPABASE_ACCESS_TOKEN`). The project ref is **derived** from `VITE_SUPABASE_URL` rather than written down, because deploying to the wrong project succeeds, prints success, and leaves the app failing exactly as before — there would be nothing to see. Uses `--use-api`, so **no Docker**. `--dry-run` prints the resolved target and deploys nothing. This exists as a script rather than a documented command because the one-line form is ~90 characters and wrapped in a terminal twice on 2026-08-20, running as two commands and silently deploying nothing. Confirm with `npm run check:live` |
| `npm run check:live` | **Does the live project have what the client asks for?** Probes every table and column in `src/lib/liveSchema.js` with `limit(0)`, every RPC in the same file with a GET — which PostgREST serves in a read-only transaction, so a function that writes cannot write — and, since #115, every **Edge Function** the app invokes, with the CORS preflight a browser sends before `functions.invoke`. A preflight is not the call, so nothing is invoked. It reads schema and never data. Since #246 it signs in as the seeded account behind `TASKR_TEST_EMAIL` — the same third precondition as `test:rls` — and revokes that session on exit, leaving nothing behind; until then it signed in **anonymously** and minted one permanent auth user per run, which is how 45 accumulated on the live project before the count was traced back to it. **Since #250 that account is itself a counted row, and the reason is a four-day silence.** The account was deleted around 2026-08-25 as ordinary collateral of a tidy-up; `npm run test:rls` threw in its `beforeAll` on every run for four days and **nothing said so**, because vitest reports a `beforeAll` failure as its tests SKIPPED — *measured on this file before the change*, 26 total, **0 failed**, 26 pending, `success: false`, naming nothing, which reads as an environment hiccup rather than as a dead instrument. Recreating the account took about four minutes; the four days were the expensive part, and two of the RLS suite's own tests went stale inside the window — one written on 2026-08-26 and never once executed, one falsified by `0016` the same day. **A dead instrument does not merely stop reporting: it is the only thing that was going to notice, so its silence is also permission.** So the sign-in is now asserted in a test rather than performed in a hook — a row can go red, a hook cannot — and its failure names the account and separates the two states that have different fixes (`email_not_confirmed`, meaning the account exists and the password is right and it was created without ticking **Auto Confirm User**; `invalid_credentials`, meaning it is absent or the password is wrong, which is how the deletion presented). Every probe that needs the session then refuses with `NOT ASKED` rather than running as `anon` and reporting a healthy project as broken. Run it after pasting a migration **and after deploying a function** — and occasionally when nothing in the repo has changed, because its subject moves without the file. **The expected-red set holds TWO, both added by #96 and neither yet measured**: `calendar_busy` until `0030` is applied, and the `calendar-busy` Edge Function until it is deployed — one action each, and a paste clears only its own. The denominator becomes 34. Written here in the same change that created them, because the paragraph below records this cell going stale on exactly this seam three times, in both directions. Before #96 the set was EMPTY. *Measured 2026-09-02 at 32 of 32*, with `0001`-`0029` all applied, which is what [`docs/access-model.md`](docs/access-model.md) has said since `0028` landed — the same figure on both sides of that apply, `0028` being a function body this check cannot see (#306). It read *32 of 32 on 2026-09-01* too, after `0027`. The denominator moved from 30 to 32 on 2026-09-01 when #305 added `miss_chore` and `unmiss_chore` **red on purpose until `0027`** — both green, plus `chores.missed_at`, after the apply in that story's own session (*29 of 32 before, 32 of 32 after*). It moved from 28 on 2026-08-31, when #105 added `chore_repeat_exceptions` and `skip_repeat_occurrence` **red on purpose until `0025`**; both are green now, so that entry drained on exactly the action it named. It read *28 of 28 on 2026-08-28*, after `0023` was applied in #211's own session — the reading before that apply was a *measured* **27 of 28**, `chores` answering `42703` on `chores.source`, which is the first time both sides of an apply were recorded here rather than one being inferred. And at the same 28 of 28 just before it, after #250 added the two seeded-account rows — the denominator moved from 26 for the first time on something no migration can change, and no row became excusable. Before that, at 26 of 26 the same day, after #59's session applied `0021` with `npm run migrate:live` — and at the same figure earlier that day after #50's session applied `0020` the same way. `0021` widened the `member_split_seen` entry by one column rather than adding an entry, which is why the denominator did not move. The `member_split_seen` row stood at a measured 25 of 26 within that session and drained on exactly the action it named. Before #50 widened the instrument it was EMPTY too — *measured 2026-08-27 at 25 of 25*, after `0018` was applied (#231). It held TWO between #49’s merge and that application — `chores` refusing `assigned_source` and `apply_assignments` unresolved — and both cleared on exactly that one action; the denominator moved to 25 because #49 added the `apply_assignments` probe, and to 26 when #50 added the seen-marker table. Before that, `0014` was pasted on 2026-08-26 and both its reds cleared on exactly that action; *measured the same afternoon at 24 of 24*. This cell said EMPTY throughout the window between #159's merge and that paste, when the set held two: #159 added the row to `docs/access-model.md` and did not reach here, and the paste made the sentence true again before anyone noticed it had stopped being so. **It has now gone stale on this same seam three times, and the third was the opposite direction**: PR #216 recorded the `0015` paste in `docs/access-model.md` and did not reach here, so this cell claimed ONE excused row while the set was empty — the weaker failure of the two, because an excused row that is not really excused is a red nobody will chase. Settled by running the instrument rather than by choosing between the documents: 24 of 24, green, 2026-08-26. It read 20 of 20 on 2026-08-20; the denominator became 21 on 2026-08-21 when #37 added a table, 23 on 2026-08-24 when #95 added a table and a function, and 24 the same day when #53 added an RPC. **Not run by CI** for the same reason as `test:rls`, and loud rather than skipped when unconfigured — the lists it works from *are* checked by CI, in `src/lib/liveSchema.test.js`. **It is structurally blind to `0009`, `0013`, `0016`, `0017`, `0019`, `0024`, `0028` and `0029`** — `0009` changes only indexes, `0013` grants privileges the live project already holds by inheritance, `0016` (#152) changes one RLS policy, which is a subject this check does not read at all, `0017` (#186) revokes what **`anon`** holds, which is a ROLE this check never asks about, `0019` (#227) revokes what **`authenticated`** holds at TABLE level while re-granting the same columns, so the client reads exactly what it read before, `0024` (#54) grants UPDATE on the repeat pair — a privilege this check only ever exercises by reading — `0028` (#306) replaces the BODY of `catch_up_repeats_at`, where this check probes a function by name and argument set and that file changes neither, and `0029` (#307) widens a CHECK CONSTRAINT and replaces two function bodies, none of which is a table, a column or a signature — so each reads the same either side of its paste, and each is blind for a different reason. A green run is not evidence that any of the eight was applied. **All eight have since been applied and confirmed, and none by this check**; `0028` by a read-only `pg_get_functiondef` over the Management API in #306's own session (*measured 2026-09-02*: the supersede step absent from the live body before the apply and present after it, the function's comment naming #306 only afterwards, and the privileges `0012` set surviving the replace), `0024` by `npm run probe:live-grants`, whose two `arw` rows for the repeat pair read ok — *measured 2026-09-01 at 14 of 14, negative control included; it read 13 of 13 in that session, and #105's `chore_repeat_exceptions` is the fourteenth* — in the same session that applied it (#54) — `0009` by `npm run test:rls`, which cannot reach its first assertion without it, `0013` by reading `pg_attribute.attacl` in the SQL editor on 2026-08-26 (#150), where its column grants are plainly visible, and `0016` by reading `pg_get_expr(polqual, polrelid)` for `members_delete_same_household` on 2026-08-27 (#198), which carries the `is_household_organizer` clause no other migration writes. `0017` is the fourth, and it is now confirmed too: *measured 2026-08-27*, `npm run probe:live-grants` reads **anon holds no table-level or column-level privilege in `public` and may execute no function there**, 6 of 6 agreeing with its own negative control — the same catalog, for the role this check cannot ask about. The blindness belongs to this check, not to the world. [`docs/access-model.md`](docs/access-model.md) carries the excused-red table — two rows, both #96's — and the history of the fifteen times that set has been inverted |
| `npm run check:deployed` | **Is production running the current Edge Function source?** — #222, and the omission `check:live` is structurally blind to. `check:live` asks whether a function is *there and callable*, which a superseded build answers just as well — #196 measured it 24 of 24 green while production served a build a day older than the source. This reads the platform's own record (`GET /v1/projects/{ref}/functions` through the Management API) and prints, per function in `scripts/deploy-function.mjs`'s list, the deployed `version`, `updated_at` and `ezbr_sha256` beside the last commit touching that function's source — **exiting non-zero when a deploy predates its source**, with `npm run deploy:function` named as the fix. The hash is printed rather than compared: it is content-addressed (*measured on #196* — an identical redeploy moved the version and left it unchanged), so it is what a human checks a suspect deploy against. The function list is **imported from the deploy script**, so a third function cannot be added to one and missed by the other. Needs `SUPABASE_ACCESS_TOKEN`. Run it after merging anything under `supabase/functions/` — a merge deploys nothing, and that is the omission this exists to catch. **Not run by CI** |
| `npm run migrate:live <file>` | **Apply one migration from `supabase/migrations/` to the live project** — #185, the token route. It takes a FILE and never SQL: a general "run this against production" command is the thing a personal access token makes easy and the thing deliberately not built, so a path outside that directory is refused here rather than sent. Two round trips, in an order that is the whole design — it first asks Postgres for the **length, byte count and md5 of the payload it received**, compares those against the file on disk, and applies nothing if they disagree. That is the check [#150](https://github.com/SailorDave17/Taskr/issues/150) did by hand, done automatically and **from the far end**: a file compared against itself proves nothing, and on this machine a clipboard can re-encode one in transit. Needs `SUPABASE_ACCESS_TOKEN` and **refuses by name without it**, never falling back to the anon key. `-- --dry-run` prints the plan, needs no credential and sends nothing. Owner-only, and deciding to paste is still a deliberate act with a sequence: apply, then promote |
| `npm run probe:live-grants` | **Read the live project's grant catalog** — #185, and the thing `check:live` is structurally blind to. `check:live` asks the questions the client asks, so it sees a missing SELECT grant for free and nothing else; a column-scoped grant of a privilege the role already holds is invisible to it, which is the whole of `0013`. This reads `pg_class.relacl` and `pg_attribute.attacl` through the Management API, which is not PostgREST and so is not stopped by `information_schema` being unexposed. Since #186 it also reads **every relation and every function in `public`** rather than the tables `LIVE_SCHEMA` names — from `pg_namespace`, so a table a future migration adds is audited the day it lands rather than the day somebody remembers to list it — and asks two further questions: that **`anon` reaches nothing** anywhere in `public`, PUBLIC function grants included, and that **`authenticated` is exactly where it was** on all nine tables. The second is the control, and it is the point: `revoke all ... from anon` is one word from `... from authenticated`, so a revoke that hit the wrong role would leave the first question looking precisely like success. It was **RED until `0017` was applied**, deliberately and by four rows, in the same way `LIVE_SCHEMA` carries a table whose migration has not been applied yet — an entry earns its place by what it asks, not by what it currently answers. *Measured 2026-09-01 under #305*, it reads **15 of 15, negative control included**: anon reaches nothing in `public`, and the `authenticated` control is where it was. The fifteenth row is `chores.missed_at=r`, whose whole content is the two letters it lacks — `check:live` can see the column is readable and cannot see that no client role may write it. It read 14 of 14 under #103 on 2026-08-31. It reconciles what it finds against **what #150 measured on 2026-08-26** and exits non-zero on a disagreement. It carries a **negative control** — `chores.repeat_since`, which `0012` grants to nobody — because a probe that reports grants everywhere cannot report an absence. It takes no arguments, sends only `select`s built from `src/lib/liveSchema.js`'s own table list, and refuses to send a statement carrying a write verb. Needs `SUPABASE_ACCESS_TOKEN`. **Not run by CI** |

### The two variables you need

Copy [`.env.example`](.env.example) to `.env.local` and fill in both values from the Supabase project
dashboard:

| Variable | Where it comes from |
|---|---|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → Data API |
| `VITE_SUPABASE_ANON_KEY` | the **publishable** key, never the secret one |
| `VITE_GOOGLE_CLIENT_ID` | *optional, #95* — Google Cloud console → Credentials. The client **ID** (`…apps.googleusercontent.com`), never the `GOCSPX-…` secret |

`.env.local` is already covered by `.gitignore`, and credentials never enter git.

**Without them the app runs and shows "No backend configured".** That is a deliberate state, not a
crash — a local checkout with no `.env.local` is normal — but it is also the answer to "why is
nothing happening", so it is written here rather than left to be rediscovered.

**`VITE_` means inlined into the client bundle**, readable by anyone who views source. That is safe
for the publishable key *only* because row-level security is on. The `service_role` key bypasses RLS
entirely and must never reach any `VITE_` variable; the build refuses outright if it does
(`src/lib/keyShape.js`), which exists because it happened once.

Since #95 the same guard covers the Google pair, and a test asserts it is asked about **every**
`VITE_` variable the build reads rather than the two somebody remembered — a new one is covered by
being added, or that test goes red. A Google client **ID** belongs in the bundle; a `GOCSPX-…`
client **secret** and a `1//…` refresh token do not, and neither can reach a browser: the secret
lives in the Edge Function's environment and the token in `calendar_tokens`, which no client is
granted anything on.

## Branching — read this before you cut a branch

**Changed 2026-08-27.** This repository had four branch roles from 2026-08-12; it is back to three.
`rebuild/v1` — the integration branch from 2026-08-05 to 2026-08-27, and the reason `develop` used
to be excluded here — is retired. Nothing was lost folding it back in: every commit it ever carried
is an ancestor of `develop` (`git merge-base --is-ancestor origin/rebuild/v1 origin/develop`; the
only difference is two `rebuild/v1 → develop` sync merges, #30 and #239). The deviation from the
workspace's usual branch-off-develop model no longer applies either, now that `develop` holds the
whole rebuild rather than 2020 dead code.

| Branch | Role |
|---|---|
| **`develop`** | **The integration branch, and the repository default.** Branch from here; merge back here. |
| `release` | **What Vercel builds production from.** Entered only by a pull request from `develop` that the owner merges, after the migrations that branch assumes are applied. Never a working branch. |
| `main` | The **backup branch**: a known-good working version to fall back to if `release` breaks and cannot be fixed in place (owner directive, 2026-09-01). Also the original **cutover target**, tagged `legacy-final`. Never a working branch and never a base — entered only by a pull request **from `release`** that the owner merges, so the backup is by construction a state production actually ran. The "Release to main" catch-up merges (#230, *measured* 2026-08-27) are that backup being taken, not drift. It is allowed to sit behind `release` and *measured 2026-09-01* it does, by 22 commits, so run `git log origin/main..origin/release` before treating it as a current fallback. |

Confirm the default with `gh repo view --json defaultBranchRef` rather than trusting any document,
including this one — it has been wrong here before (2026-08-05).

**All three are enforced, not merely described.** Since 2026-09-03 (#289) ruleset 21859879 requires
a pull request and a successful `Lint, test, build` on each of them, with no bypass actors — so a
direct push to `develop`, `release` or `main` is refused whoever attempts it, and a pull request
whose check is red or missing cannot merge. Read the live state with
`gh api repos/SailorDave17/Taskr/rules/branches/<name>`, **never**
`gh api repos/SailorDave17/Taskr/branches/<name>/protection`: the legacy endpoint cannot see a
ruleset and answers `404 Branch not protected`, which is a true sentence and a misleading reading.

Branch names follow `feature/<issue-number>-short-description`.

## CI and deployment

Both are documented once, elsewhere. These links are the single copy; a summary here would be the
stale copy within a week.

- **[`docs/ci-gate.md`](docs/ci-gate.md)** — what `.github/workflows/ci.yml` enforces (lint, test,
  build, and an assertion that the build emitted a real artefact), plus the recorded proof that each
  step can actually fail. Since 2026-09-03 (#289) the gate is **enforcing**, not advisory: ruleset
  21859879 requires a pull request and a successful `Lint, test, build` on `develop`, `release` and
  `main`, so a direct push to any of them is refused and a red run blocks the merge.
- **[`docs/deploy-runbook.md`](docs/deploy-runbook.md)** — how hosting is set up and how a push
  becomes a deployment, including the settings that were wrong the first time and how they were
  found.

**Merging into `develop` does not deploy anything.** Production is built from `release`, and
moves only when a pull request from `develop` into `release` is merged — deliberately, by the
owner, after the migrations the branch assumes have been pasted into the live project. (Until
2026-08-27 this paragraph read `rebuild/v1`, the integration branch's earlier name and the repo's
earlier default — see *Branching* above.)

That split is 2026-08-12 and it replaced the opposite arrangement, where production tracked
`rebuild/v1` and **the merge was the deploy**. Migrations here are applied by hand (see above), so
that coupling meant a branch whose client needed an unpasted migration went live the instant it
landed — which is the 2026-08-09 outage in [`docs/access-model.md`](docs/access-model.md), and was
about to happen a second time. Splitting the branches makes applying the migration and promoting the
client two acts in an order somebody chooses.

> **Discharged 2026-08-12, and #62 was the thing that proved it.** This block used to say the
> coupling was what made #62 dangerous to merge, and that the fix had to come first. It did, and it
> worked — on that exact branch.
>
> The danger was specific: #62's client asks for `members.email` and calls a three-argument
> `create_household`, and the live project had neither until `0007` was pasted. Under merge-is-deploy
> that goes live the instant it lands, which is the 2026-08-09 outage repeated. *Measured* when
> PR #89 merged: `rebuild/v1` moved to `d20a809`, `release` stayed at `fcabfc7`, and production went
> on serving `fcabfc7` — the same `assets/index-*.js` file, not a rebuild that happened to match. The
> merge deployed nothing.
>
> The line worth keeping is the one this block ended on before it was discharged: the mitigation used
> in August was *an accurate paragraph in a document*, and that is why it was never the whole fix. A
> paragraph explains the hazard to whoever reads it. What actually held here was a branch that
> deploys nothing and a `githooks/owner-only` entry refusing a push to the one that does.

## The rest of `docs/`

- [`access-model.md`](docs/access-model.md) — how a household joins, what that actually protects,
  and which migrations are applied to the live project. **The one to read before touching the data
  layer.**
- [`refresh-charter.md`](docs/refresh-charter.md) — what Taskr is for, the bar, and why the verdict
  was rebuild rather than refactor.
- [`hosting-decision.md`](docs/hosting-decision.md) — the hosting and backend choice, the
  alternatives, and the free-tier limits later stories must be designed against.
- [`data-outside-production.md`](docs/data-outside-production.md) — who can see household data in
  the environments *around* production: the decision to gate preview deployments behind a custom
  domain (**applied 2026-08-21 — #121**), and the rule that keeps real household names out of
  fixtures and screenshots. **Read before writing a fixture or committing an image.**
- [`allocation-corpus.md`](docs/allocation-corpus.md) — the scenario corpus the allocator is
  judged against, the recorded proportion of household shapes that reach level, and the ones
  that arithmetically cannot.
- [`rebalance-churn.md`](docs/rebalance-churn.md) — what staying stable costs: the churn a
  re-balance causes with no stability rule at all, and the measured table of change budget against
  minutes moved against levelness reached that set `CHANGE_BUDGET_MINUTES`. **Read before changing
  the tie-break or the change budget.**
- [`extraction-corpus.md`](docs/extraction-corpus.md) — the sixty plain-language
  descriptions the AI bet's accuracy is scored against, what the grader measures and what it
  deliberately does not, and the floor and ceiling the two control extractors reach. **Read
  before touching the extraction corpus or grader.**
- [`extraction-run.md`](docs/extraction-run.md) — the AI bet graded against a live model at two
  configurations (#206, measured 2026-08-31): accuracy, due dates, per-kind latency and cost per
  household per year, each placed between the corpus's recorded floor and ceiling, with the kill
  conditions read against every figure. **Read before arguing the bet is settled either way.**
- [`capacity-model.md`](docs/capacity-model.md) — baseline versus this week’s override, why the week
  begins on Monday, and the access rules on `member_capacity`. **Read before touching capacity or
  the week boundary.**
- [`license-scope.md`](docs/license-scope.md) — what the MIT license in `LICENSE` does and does not
  cover, given the legacy code's five classroom contributors.

## License

MIT — see [`LICENSE`](LICENSE), and [`docs/license-scope.md`](docs/license-scope.md) for what it
applies to.
