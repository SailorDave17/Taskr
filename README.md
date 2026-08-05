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
[#2](https://github.com/SailorDave17/Taskr/issues/2). What is live today is the deployed shell — an
installable page that proves everything after it ships onto something real.

**The app currently persists nothing.** There is no database wired up, and that is deliberate rather
than missing: the household roster is story [#5](https://github.com/SailorDave17/Taskr/issues/5),
which is where schema, access control and the first stored record all arrive together. Do not go
hunting for a backend; it is not there yet.

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

Local runtime configuration goes in `.env.local`, which `.gitignore` already covers. Credentials
never enter git. Nothing in the shell needs any yet.

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

- [`refresh-charter.md`](docs/refresh-charter.md) — what Taskr is for, the bar, and why the verdict
  was rebuild rather than refactor.
- [`hosting-decision.md`](docs/hosting-decision.md) — the hosting and backend choice, the
  alternatives, and the free-tier limits later stories must be designed against.
- [`license-scope.md`](docs/license-scope.md) — what the MIT license in `LICENSE` does and does not
  cover, given the legacy code's five classroom contributors.

## License

MIT — see [`LICENSE`](LICENSE), and [`docs/license-scope.md`](docs/license-scope.md) for what it
applies to.
