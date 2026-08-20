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
phone with the wrong date cannot move work between weeks. Each chore can be **given to a person**,
and the screen says what every member is carrying and what is left of their week — in plain minutes,
in roster order, derived at read time rather than stored. It
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
so the database is now on per-member auth and `npm run check:live` is green at **20 of 20** —
every table, every RPC, and the `provision-member` Edge Function, which was deployed on
2026-08-20 (#112) with `npm run deploy:function`. No red is expected, so any red is real. Two things
are deliberately still true after that paste, and both are sequence rather than oversight:

- **What production serves is still the PIN build.** Vercel builds production from `release`, which
  sits behind `rebuild/v1` until the promotion pull request is merged. That split is the whole point
  — see *Branches* below.
- **The Edge Function is not deployed.** Pasting `0007` cleared every existing claim, and restoring
  access needs `service_role`, so it needs the function built by #87
  (`supabase/functions/provision-member/`, both provision and reset paths). The migration's own
  section 9 carries the ordering: provision the organizer first, then everyone else from the app.

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

**<https://taskr-khaki.vercel.app>**

That is the assigned production domain, the one to publish and to test against. Vercel also answers
on a `<project>-<account>` alias, which currently serves the same build — but it is not the assigned
domain and the two are not guaranteed to stay pointed at the same deployment, so it is deliberately
not named here.

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
| `npm run test:rls` | The live row-level-security suite. Goes over the wire to the real Supabase project, so it needs `.env.local` and the migrations applied. **Not run by CI** — it is excluded there deliberately, because a security test that quietly passes when unconfigured is the same defect as a gate with no tests in it |
| `npm run test:functions` | **The provisioning Edge Function, against a real stack.** Needs Docker: `npx supabase start` and `npx supabase functions serve --no-verify-jwt`. **Not run by CI** — it needs Postgres, GoTrue and a `service_role` key, and it targets the LOCAL stack, never the hosted project, because provisioning creates auth users. Loud rather than skipped: it fails with instructions when the stack is down |
| `npm run deploy:function` | **Deploy the provisioning Edge Function to the hosted project.** Owner-only: it needs a Supabase access token (`npx supabase login`, or `SUPABASE_ACCESS_TOKEN`). The project ref is **derived** from `VITE_SUPABASE_URL` rather than written down, because deploying to the wrong project succeeds, prints success, and leaves the app failing exactly as before — there would be nothing to see. Uses `--use-api`, so **no Docker**. `--dry-run` prints the resolved target and deploys nothing. This exists as a script rather than a documented command because the one-line form is ~90 characters and wrapped in a terminal twice on 2026-08-20, running as two commands and silently deploying nothing. Confirm with `npm run check:live` |
| `npm run check:live` | **Does the live project have what the client asks for?** Probes every table and column in `src/lib/liveSchema.js` with `limit(0)`, every RPC in the same file with a GET — which PostgREST serves in a read-only transaction, so a function that writes cannot write — and, since #115, every **Edge Function** the app invokes, with the CORS preflight a browser sends before `functions.invoke`. A preflight is not the call, so nothing is invoked. It reads schema and never data. Run it after pasting a migration **and after deploying a function**. **Not run by CI** for the same reason as `test:rls`, and loud rather than skipped when unconfigured — the lists it works from *are* checked by CI, in `src/lib/liveSchema.test.js`. **No red is expected** — it returns 20 of 20 as of 2026-08-20, so any red is new and real; [`docs/access-model.md`](docs/access-model.md) carries the history, including why the set was briefly non-empty |

### The two variables you need

Copy [`.env.example`](.env.example) to `.env.local` and fill in both values from the Supabase project
dashboard:

| Variable | Where it comes from |
|---|---|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → Data API |
| `VITE_SUPABASE_ANON_KEY` | the **publishable** key, never the secret one |

`.env.local` is already covered by `.gitignore`, and credentials never enter git.

**Without them the app runs and shows "No backend configured".** That is a deliberate state, not a
crash — a local checkout with no `.env.local` is normal — but it is also the answer to "why is
nothing happening", so it is written here rather than left to be rediscovered.

**`VITE_` means inlined into the client bundle**, readable by anyone who views source. That is safe
for the publishable key *only* because row-level security is on. The `service_role` key bypasses RLS
entirely and must never reach any `VITE_` variable; the build refuses outright if it does
(`src/lib/keyShape.js`), which exists because it happened once.

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
- [`allocation-corpus.md`](docs/allocation-corpus.md) — the scenario corpus the allocator is
  judged against, the recorded proportion of household shapes that reach level, and the ones
  that arithmetically cannot.
- [`capacity-model.md`](docs/capacity-model.md) — baseline versus this week’s override, why the week
  begins on Monday, and the access rules on `member_capacity`. **Read before touching capacity or
  the week boundary.**
- [`license-scope.md`](docs/license-scope.md) — what the MIT license in `LICENSE` does and does not
  cover, given the legacy code's five classroom contributors.

## License

MIT — see [`LICENSE`](LICENSE), and [`docs/license-scope.md`](docs/license-scope.md) for what it
applies to.
