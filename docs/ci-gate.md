# The CI gate, and the proof it can fail

- Date: 2026-08-04
- Story: #4
- Scope: what `.github/workflows/ci.yml` enforces, and the evidence each step is capable of failing

Before this, `.github/` contained only `.keep`. There was no CI in this repository at all, so this
gate is built from nothing rather than extended — and a gate nobody has watched fail is a gate nobody
has any reason to trust.

## What runs

| Step | Command | Fails when |
|---|---|---|
| Lint | `npm run lint` | any ESLint error |
| Test | `npm test` (`vitest run`) | any failing test, **or zero tests found** |
| Build | `npm run build` | Vite build error |
| Artefact assertion | inline `test -f` | `dist/index.html`, `dist/manifest.webmanifest` or `dist/sw.js` missing |

The artefact assertion exists because a build step can succeed while emitting nothing useful. The
manifest and service worker are the two files whose absence would mean the app silently stops being
installable — the failure would show up as "Add to Home Screen is missing", on a phone, with a green
pipeline behind it.

## Zero tests must fail — AC 4

`vitest run` exits `1` when it finds no test files. That is currently the default, and
`passWithNoTests: false` is nonetheless pinned **explicitly** in `vite.config.js`, because a default
can change under you and this is the exact "check that cannot fail" the AC is written against.

`src/test/gate.test.js` asserts the pin is present. That guard is the point: the suite's meaning
depends on a *configuration*, and a configuration-dependent suite passes vacuously the moment the
configuration stops applying.

## Proofs — every one of these was run, not reasoned

Recorded here because a guard that has never refused is untested code holding the gate.

| # | Mutation | Result | Exit |
|---|---|---|---|
| 1 | Both test files moved away (zero tests) | `No test files found, exiting with code 1` | **1** |
| 2 | `passWithNoTests: false` line deleted from `vite.config.js` | `gate.test.js` — **1 of 6** tests red | **1** |
| 3 | `<h1>Taskr</h1>` changed to `<h1>Chores</h1>` in `App.jsx` | `App.test.jsx` — **1 of 6** tests red | **1** |
| 4 | Unused variable added to a new `.js` file | `no-unused-vars` error | **1** |

All four were reverted; the suite is green at 6/6 and lint is clean.

**Both mutations reddened exactly one test, not half the suite.** That distinction matters: a
mutation that reddens most of a suite proves the tests are coupled to each other, not that they cover
the thing you broke.

Proof 2 is the one worth keeping. It mutates the **configuration** rather than the code — the ground
the tests stand on — and code-only mutation says nothing about it.

## Recorded failing CI run — AC 3

Done, on the real pipeline rather than locally.

| | |
|---|---|
| Failing run | [30972347351](https://github.com/SailorDave17/Taskr/actions/runs/30972347351) — **failure** |
| Commit | `7fde78f` — "test: DELIBERATELY BROKEN - prove the CI gate can fail (AC 3 of #4)" |
| Reverted by | `eb5f51c` |
| First green run | [30972263900](https://github.com/SailorDave17/Taskr/actions/runs/30972263900) — commit `1d7ebc1`, all 8 steps `success` |

**Which step failed matters more than that one did.** The cascade was:

```
5. Lint                              => success
6. Test                              => failure     <- the deliberate break
7. Build                             => skipped
8. Assert the build produced artefact => skipped
```

So the pipeline refused for the intended reason, at the intended step, and correctly declined to
build or ship afterwards. A run that went red at `Install` would have been a red run proving nothing.

The failure text names the injected test by name:

```
FAIL src/App.test.jsx > App shell > PROOF OF FAILURE: this assertion is false on purpose
Tests  1 failed | 6 passed (7)
```

**The green run was checked step-by-step too**, not just by its conclusion — all 8 steps report
`success`, none skipped. A build tool's own summary is not evidence that the thing you care about
actually executed; the failure mode there is a *pass*, so nothing draws attention to it.

## What triggers a run — corrected 2026-08-30 (#243)

| Event | Branches |
|---|---|
| `push` | `develop`, `release`, `main`, `feature/**` |
| `pull_request` | `develop`, `release`, `main` |

**These are exact names, and the reason is a defect that shipped.** When the integration branch moved
`rebuild/v1` -> `develop` on 2026-08-27, the trigger lists were updated by renaming `rebuild` to
`develop` and keeping the `/**`. That glob was only ever correct because the old branch had a slash
in it: `rebuild/**` matches `rebuild/v1`, while `develop/**` requires a literal `develop/` prefix and
matches neither the branch `develop` nor a pull request into it.

*Measured 2026-08-30, before the fix:*

- **Zero** CI runs on branch `develop`, ever.
- The most recent `pull_request`-event run was 2026-08-28T01:42Z, from the `rebuild/**` era. Every
  run after it is a `feature/**` push.
- PR #283 (`develop` -> `release`, the merge that deploys production) and PR #282
  (`release` -> `main`) both merged carrying **only Vercel checks — no `Lint, test, build` at all.**

**It looked fine, and that is the part worth remembering.** `gh pr checks` reports the checks
attached to a pull request's head SHA whatever event produced them, so the `feature/**` push run
shows up on the pull request and reads as a pass. What it is *not* is a run of the merge result: a
push run tests the head commit in isolation, so a branch that is stale against `develop` can report
green while the merge it is about to become would fail.

`src/test/gate.test.js` now asserts this table against the branch model in `README.md`, including a
control that fires on the exact broken list. Nothing in the suite read this file before, which is why
`npm test` was green throughout — and #243's own AC 3 had named the risk in advance: *a trigger list
is exactly the kind of claim that is satisfied by inspection and false in practice.*

## Branch protection — AC 5, and the honest answer

> **The premise below expired, and the first correction to it was WRONG.** Everything after this
> block is kept as the 2026-08-04 record; read this first.
>
> *Measured 2026-08-30*: `gh repo view --json visibility` answers **PUBLIC**, so the 403 and the
> "purchasing decision" it justified no longer describe this repo. That much stood. The same edit then
> asserted protection was *"available and unconfigured"* — **false when it was written.** A ruleset was
> already active, and the check that would have shown it was not run: `visibility` was read and the
> rulesets API was not, in an annotation to a paragraph whose own last line names rulesets as a
> separate thing. Re-measured the same day:
>
> ```
> $ gh api repos/SailorDave17/Taskr/branches/develop/protection
> {"message": "Branch not protected", "status": "404"}
>
> $ gh api repos/SailorDave17/Taskr/rules/branches/develop
> [{"type": "deletion", ...}, {"type": "non_fast_forward", ...}]
> ```
>
> **Both answers are true, and only one of them describes the repository.** Classic branch protection
> is absent, which is what the 404 says; a *ruleset* is active, and the legacy endpoint cannot see it.
> `Branch not protected` is therefore a correct sentence and a misleading reading — **ask
> `rules/branches/<name>`, never `branches/<name>/protection`, before concluding a branch is open.**
>
> **What is actually enforced, as of 2026-08-30.** Ruleset **`Branches not to delete`** (id 21859879),
> enforcement `active`, **no bypass actors**, targeting `~DEFAULT_BRANCH`, `main`, `develop` and
> `release`. It carries exactly two rules:
>
> | Rule | Effect |
> |---|---|
> | `deletion` | those branches cannot be deleted, by anyone |
> | `non_fast_forward` | they cannot be force-pushed, by anyone |
>
> So **destruction is now prevented and a failing merge is not.** There is no `pull_request` rule, so
> a direct push to `develop` still lands, and no `required_status_checks` rule, so a red run does not
> block a merge. **For pass/fail the gate remains advisory**, exactly as the section below says — the
> sentence is still true, for a narrower reason than when it was written.
>
> **Ratified 2026-08-30, not yet applied — tracked as #289:** require a pull request, and require the
> **`Lint, test, build`** check (app `github-actions`), on `develop`, `release` and `main`. That makes
> the gate enforcing rather than advisory, and it stops direct pushes to `develop` — accepted as the
> cost.
>
> **The ordering is load-bearing and must not be reversed.** A required check must name a context that
> actually *fires* on the branch it guards. Until #243's trigger fix is merged, a pull request into
> `release` or `main` produces no `Lint, test, build` run at all, so requiring it first would leave
> promotion pull requests waiting forever on a status nobody can produce — the same defect this file's
> *What triggers a run* section documents, arriving from the enforcement side. **Merge the trigger fix,
> confirm a real run on each target branch, then add the rules.** #289 carries that ordering as its
> first criterion and names #243 as its dependency.

**Branch protection is not configured, and it is not configurable on this repository.** *Measured
2026-08-04:*

```
$ gh api repos/SailorDave17/Taskr/branches/rebuild%2Fv1/protection
{
  "message": "Upgrade to GitHub Pro or make this repository public to enable this feature.",
  "status": "403"
}
$ gh repo view SailorDave17/Taskr --json visibility
PRIVATE
```

So "add branch protection" reads as a configuration task and **is a purchasing decision** — invisible
until the write is attempted. The newer rulesets API is gated the same way; it is not a route around
the older one.

**This gate is therefore advisory, and must never be recorded as "protected".** CI reports on pushes
and pull requests, and nothing stops a direct push that fails it. The options, if that is not good
enough later, are: make the repo public, buy GitHub Pro, or add a `githooks/pre-push` — and a
pre-push hook stops the habit, not an adversary, since it lives in one checkout and `--no-verify`
skips it silently.

<!-- #289 AC 4 probe: a PR whose required check has not reported success. Closed immediately. -->
