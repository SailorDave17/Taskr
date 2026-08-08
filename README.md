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
phone with the wrong date cannot move work between weeks. It
persists to Supabase — data survives a restart, a reinstall and a redeploy, because it is in a
hosted database rather than on the device.

**What protects it is server-side.** Row-level security policies and column-level grants, in
`supabase/migrations/`, asserted by tests that bypass the client. A client-side guard is not a guard,
and the reasoning — including the honest statement of what the access model does *not* protect
against — is [`docs/access-model.md`](docs/access-model.md). Read that before touching the data
layer.

**Migrations are applied by hand.** There is no Supabase CLI or Docker on the build machine, so each
file in `supabase/migrations/` is pasted into the Supabase SQL editor by a person, at the merge of
the story that adds it. `docs/access-model.md` tracks which ones are live. They are re-runnable and a
test proves it, because a re-paste after a partial failure is the normal path.

**The engine exists; nothing on screen reaches it yet.** The allocator (#40) divides work by capacity
and says plainly when level is unreachable, judged against a 13-shape corpus; per-week capacity (#44)
makes a person's minutes a fact about *this* week rather than a standing number. Both are pure,
tested modules with **no caller** — so from a phone there is still **no allocation**, which is the
thing the app is ultimately for. That gap is deliberate and it is where the next work goes: applying
migration `0005` to the live project is #45, setting a week's capacity by hand is #46, and the load
view that makes the split visible is #47.

Still to come and genuinely absent: assigning a chore to a person (#36). The 2020 classroom original
is preserved at tag `legacy-final` and is not the code in this branch.

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
| `npm run test:rls` | The live row-level-security suite. Goes over the wire to the real Supabase project, so it needs `.env.local` and the migrations applied. **Not run by CI** — it is excluded there deliberately, because a security test that quietly passes when unconfigured is the same defect as a gate with no tests in it |

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

This repository has **three branch roles**, and only one of them is where work goes. The names are
misleading if you go by convention, so go by this table.

| Branch | Role |
|---|---|
| **`rebuild/v1`** | **The integration branch, and the repository default.** Branch from here; merge back here. |
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

Every push to `rebuild/v1` deploys to production automatically.

## The rest of `docs/`

- [`access-model.md`](docs/access-model.md) — how a household joins, what that actually protects,
  and which migrations are applied to the live project. **The one to read before touching the data
  layer.**
- [`refresh-charter.md`](docs/refresh-charter.md) — what Taskr is for, the bar, and why the verdict
  was rebuild rather than refactor.
- [`hosting-decision.md`](docs/hosting-decision.md) — the hosting and backend choice, the
  alternatives, and the free-tier limits later stories must be designed against.
- [`license-scope.md`](docs/license-scope.md) — what the MIT license in `LICENSE` does and does not
  cover, given the legacy code's five classroom contributors.

## License

MIT — see [`LICENSE`](LICENSE), and [`docs/license-scope.md`](docs/license-scope.md) for what it
applies to.
