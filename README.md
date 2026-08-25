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
their weekly available minutes, each person signs in on their own phone with an organizer-set PIN,
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

**The PIN sentence above is about the LIVE app, and the code has already moved past it.**
[#62](https://github.com/SailorDave17/Taskr/issues/62) replaces the organizer-set PIN and the shared
join code with real per-member sign-in — each person has their own account, and `auth.uid()`
identifies a person rather than a phone.

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
  31 of 31, no skips.* **A suite that fails at setup under the old schema is a stronger presence
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
run reads a *measured* **24 of 24** and **the excused-red set is EMPTY again**. Both reds cleared on
exactly the action they named and on nothing else. **Any red, on any subject, is now real.**

[`docs/access-model.md`](docs/access-model.md) carries the excused-red table — now empty — and the
history of the eight times that set has been inverted, which is the
record worth keeping: an empty set is the state in which the check is worth the most, and every
entry added to it is a claim that has to be cleared by a named action.

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

**Migrations are applied by hand, and nothing checks that they were.** Each file in
`supabase/migrations/` is pasted into the Supabase SQL editor by a person, at the merge of the story
that adds it. *The reason recorded here used to be "there is no Supabase CLI or Docker on the build
machine". Both are available as of 2026-08-20 - the CLI through `npx`, Docker running - so the
hand-paste is a workflow that has outlived its stated cause. Automating it is a real decision rather
than a tidy-up, because it couples a merge to a schema change, and it has not been taken.* They are re-runnable and a test proves
it, because a re-paste after a partial failure is the normal path.

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
screen the moment #46 can write one. **The allocator still has no caller** — nothing on a phone
divides the work automatically, which is the thing the app is ultimately for.

That is where the next work goes: setting a week's capacity by hand is #46, showing the split as a
share of each person's own capacity is #47, and re-assigning from current capacity is #49. The
figures #36 puts on screen are deliberately the ugliest honest form — plain minutes, no bar, no
percentage, no ordering by load — because the charter's test is that a proposal satisfiable by a
screenshot of the 2020 all-users view has collapsed. #47 owns the presentation.

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
| `npm run extraction:corpus` | Re-derive the extraction corpus figures recorded in [`docs/extraction-corpus.md`](docs/extraction-corpus.md) — the shape of the sixty plain-language descriptions, and the floor and ceiling the two control extractors reach. Grades the controls only: there is no real extractor yet, so what it prints is the SCALE a later score is read against. No network call, no API key, no provider account |
| `npm run test:rls` | The live row-level-security suite. Goes over the wire to the real Supabase project, so it needs `.env.local` and the migrations applied. **Not run by CI** — it is excluded there deliberately, because a security test that quietly passes when unconfigured is the same defect as a gate with no tests in it. **It is also the only instrument that can confirm `0009`**, and it does so at *setup* rather than in an assertion: `beforeAll` puts one seeded account in two households, which the pre-`0009` global `members_claimed_by_key` forbids, so the suite cannot reach its first assertion against an unmigrated project. *Measured 2026-08-24 at 31 of 31.* It writes to the live project by design and leaves households behind — there is no client-reachable delete — so run it with that in mind |
| `npm run test:functions` | **The provisioning Edge Function, against a real stack.** `provision-member` only — `calendar-connect`'s decisions are unit-tested in `npm test` with an injected `fetch`, because its subject is what GOOGLE does and there is no local Google to point a stack at. Needs Docker: `npx supabase start` and `npx supabase functions serve --no-verify-jwt`. **Not run by CI** — it needs Postgres, GoTrue and a `service_role` key, and it targets the LOCAL stack, never the hosted project, because provisioning creates auth users. Loud rather than skipped: it fails with instructions when the stack is down |
| `npm run deploy:function` | **Deploy this repo's Edge Functions to the hosted project** — `provision-member` and, since #95, `calendar-connect`. Both by default, because the safe and complete action should be the one with the least typing; `npm run deploy:function -- <name>` narrows it, and an unknown name is refused here rather than handed to the CLI. Owner-only: it needs a Supabase access token (`npx supabase login`, or `SUPABASE_ACCESS_TOKEN`). The project ref is **derived** from `VITE_SUPABASE_URL` rather than written down, because deploying to the wrong project succeeds, prints success, and leaves the app failing exactly as before — there would be nothing to see. Uses `--use-api`, so **no Docker**. `--dry-run` prints the resolved target and deploys nothing. This exists as a script rather than a documented command because the one-line form is ~90 characters and wrapped in a terminal twice on 2026-08-20, running as two commands and silently deploying nothing. Confirm with `npm run check:live` |
| `npm run check:live` | **Does the live project have what the client asks for?** Probes every table and column in `src/lib/liveSchema.js` with `limit(0)`, every RPC in the same file with a GET — which PostgREST serves in a read-only transaction, so a function that writes cannot write — and, since #115, every **Edge Function** the app invokes, with the CORS preflight a browser sends before `functions.invoke`. A preflight is not the call, so nothing is invoked. It reads schema and never data. Run it after pasting a migration **and after deploying a function** — and occasionally when nothing in the repo has changed, because its subject moves without the file. **The expected-red set is EMPTY** — `0012` was pasted on 2026-08-24 and both its reds cleared on exactly that action; *measured the same evening at 24 of 24*. **Any red, on any subject, is real.** It read 20 of 20 on 2026-08-20; the denominator became 21 on 2026-08-21 when #37 added a table, 23 on 2026-08-24 when #95 added a table and a function, and 24 the same day when #53 added an RPC. **Not run by CI** for the same reason as `test:rls`, and loud rather than skipped when unconfigured — the lists it works from *are* checked by CI, in `src/lib/liveSchema.test.js`. **It is structurally blind to `0009`**, which changes only indexes, so a green run is not evidence that migration was pasted. [`docs/access-model.md`](docs/access-model.md) carries the excused-red table — now empty — and the history of the eight times that set has been inverted |

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

This repository has **four branch roles**, and only one of them is where work goes. The names are
misleading if you go by convention, so go by this table.

| Branch | Role |
|---|---|
| **`rebuild/v1`** | **The integration branch, and the repository default.** Branch from here; merge back here. |
| `release` | **What Vercel builds production from.** Entered only by a pull request from `rebuild/v1` that the owner merges, after the migrations that branch assumes are applied. Never a working branch. |
| `main` | The **cutover target**. Holds the tag `legacy-final` and receives the rebuild in one merge at the end. Not a working branch. |
| `develop` | The **2020 legacy tip** — dead code, kept for reference. Never branch from it. |

A newcomer who branches from the default branch is correct. A newcomer who branches from `develop`
because the name looks right is not, and nothing will stop them. Confirm the default with
`gh repo view --json defaultBranchRef` rather than trusting any document, including this one.

Branch names follow `feature/<issue-number>-short-description`.

## CI and deployment

Both are documented once, elsewhere. These links are the single copy; a summary here would be the
stale copy within a week.

- **[`docs/ci-gate.md`](docs/ci-gate.md)** — what `.github/workflows/ci.yml` enforces (lint, test,
  build, and an assertion that the build emitted a real artefact), plus the recorded proof that each
  step can actually fail. Note the honest limitation recorded there: the gate is **advisory**, not
  enforced branch protection.
- **[`docs/deploy-runbook.md`](docs/deploy-runbook.md)** — how hosting is set up and how a push
  becomes a deployment, including the settings that were wrong the first time and how they were
  found.

**Merging into `rebuild/v1` does not deploy anything.** Production is built from `release`, and
moves only when a pull request from `rebuild/v1` into `release` is merged — deliberately, by the
owner, after the migrations the branch assumes have been pasted into the live project.

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
- [`extraction-corpus.md`](docs/extraction-corpus.md) — the sixty plain-language
  descriptions the AI bet's accuracy is scored against, what the grader measures and what it
  deliberately does not, and the floor and ceiling the two control extractors reach. **Read
  before touching the extraction corpus or grader.**
- [`capacity-model.md`](docs/capacity-model.md) — baseline versus this week’s override, why the week
  begins on Monday, and the access rules on `member_capacity`. **Read before touching capacity or
  the week boundary.**
- [`license-scope.md`](docs/license-scope.md) — what the MIT license in `LICENSE` does and does not
  cover, given the legacy code's five classroom contributors.

## License

MIT — see [`LICENSE`](LICENSE), and [`docs/license-scope.md`](docs/license-scope.md) for what it
applies to.
