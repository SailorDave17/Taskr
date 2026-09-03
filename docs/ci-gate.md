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

## Branch protection — the gate is enforcing

**Current state, and the only paragraph in this section that describes the repository today.**
Everything below it is the record of how it got here, kept because two of the three previous answers
were wrong and the shape of the error is worth more than the outcome.

*Measured 2026-09-03 (#289).* Ruleset **`Branches not to delete`** (id 21859879), enforcement
`active`, **no bypass actors**, targeting `~DEFAULT_BRANCH`, `main`, `develop` and `release`. It now
carries **four** rules:

| Rule | Effect |
|---|---|
| `deletion` | those branches cannot be deleted, by anyone |
| `non_fast_forward` | they cannot be force-pushed, by anyone |
| `pull_request` | they cannot be pushed to directly — every change arrives as a pull request |
| `required_status_checks` | a pull request cannot merge until **`Lint, test, build`** reports success |

So **the gate is enforcing, not advisory.** A red run blocks the merge and a direct push is refused,
on all three branches. The cost was stated and accepted at the filing gate: it stops the owner's own
direct pushes to `develop` too, which is the point — a direct push bypasses the check entirely and
leaves the gate advisory for exactly the person most able to skip it.

`required_approving_review_count` is **0**, deliberately. GitHub does not allow you to approve your
own pull request, so any number above zero would block every merge in a solo repository permanently —
the same permanent-deadlock shape the ordering rule below exists to prevent, arriving from the review
side instead of the status side.

**Read it back from `rules/branches/<name>`, per branch, or you have not read it at all.** The proof
that this is enforced rather than merely configured is in *Proving the gate enforces* below: a rule
that is present and not acting looks identical to one that is working.

### How it was applied, and why the order could not be reversed

**A required check must name a context that actually fires on the branch it guards.** Requiring one
that cannot fire blocks that branch's merges permanently — and the repair is then gated behind the
rule that broke it. So the run was confirmed on each of the three branches **before** the rule was
added:

| Branch | Pull request | `pull_request` run | Result |
|---|---|---|---|
| `develop` | [#290](https://github.com/SailorDave17/Taskr/pull/290) | [33325929547](https://github.com/SailorDave17/Taskr/actions/runs/33325929547) | success |
| `release` | [#315](https://github.com/SailorDave17/Taskr/pull/315) | [33648973418](https://github.com/SailorDave17/Taskr/actions/runs/33648973418) | success |
| `main` | [#321](https://github.com/SailorDave17/Taskr/pull/321) | [33803273612](https://github.com/SailorDave17/Taskr/actions/runs/33803273612) | success |

**`main` is the one worth understanding**, because it fired while its own copy of the workflow could
not possibly have matched. *Measured 2026-09-03*: `main` is 37 commits behind `release` and still
carries the pre-#243 trigger list — `pull_request: ['develop/**']`, a glob that matches neither
`main` nor `develop`. The run fired anyway.

**GitHub resolves a `pull_request` trigger from the head ref, not the base.** That is measurable in
this repository's own history and was not taken on faith: PR #288 — the trigger fix itself — produced
`pull_request` run 33324936480 at 17:19Z on 2026-08-30, while `develop`, its base, still carried the
broken glob at commit `1b6bf5d`. The fix was in the head, and the head is what was read. The
consequence for anyone reading this later: **a branch whose workflow file is stale is not thereby
exempt from a required check**, so you cannot infer from a branch's own `ci.yml` whether a check will
fire on a pull request into it.

### Proving the gate enforces — the rule acting, not the rule listed

A rule that is present and unenforced reads identically to one that is working, so both halves were
observed rather than inferred.

**A direct push to `develop` is refused.** *Measured 2026-09-03*, as a real push of a revertible
docs-only commit — `--dry-run` cannot prove this, because it attempts no ref update and GitHub never
evaluates a ruleset for one. A push that is *accepted* would be the finding rather than the proof.

```
$ git push --no-verify origin HEAD:refs/heads/develop
remote: error: GH013: Repository rule violations found for refs/heads/develop.
remote:
remote: - Changes must be made through a pull request.
remote:
remote: - Required status check "Lint, test, build" is expected.
remote:
 ! [remote rejected] HEAD -> develop (push declined due to repository rule violations)
```

`origin/develop` was re-read afterwards and still stood at `663c9af` — nothing landed. Both new rules
are named in the refusal, which is the ruleset acting rather than a rule list being recited back.

**`--no-verify` is load-bearing in that command, and is not a way around anything.** This repository
sets `core.hooksPath=githooks`, and `githooks/pre-push` refuses `develop` **locally**, before the push
leaves the machine. Without the bypass the refusal would have come from the local hook and would have
proven the wrong thing entirely — the subject here is the *server-side* rule, which is the half that
holds against every client rather than one checkout. The two guards now agree, and that redundancy is
worth keeping: the local one fails in a second, the remote one cannot be skipped.

**Note that `githooks/pre-push`'s own docstring is now stale on this point.** It explains itself with
*"GitHub gates both classic branch protection AND repository rulesets behind GitHub Pro for private
repos"* and lists Taskr among the repos where "the server side cannot be made to hold the line at
all". That was true on 2026-08-04 and stopped being true when the repo went public. The hook is still
worth having for the reason its next paragraph gives — it fails in seconds instead of after a round
trip — but it is no longer the only thing holding the line here.

**A pull request whose required check has not reported success is blocked.** The before-and-after
matters more than either reading alone, because a rule that is present and not enforced produces the
*same* rule list as one that is working:

| When | Pull request | `mergeStateStatus` |
|---|---|---|
| before the rules were added, 20:42Z | #321, checks pending | `UNSTABLE` — mergeable, nothing blocking |
| after, with a check not yet successful | AC4_PR_PLACEHOLDER | `BLOCKED` |

`UNSTABLE` means *there is a failing or pending check and it does not stop you*; `BLOCKED` means the
rule is refusing the merge. Read it with GraphQL — `gh pr view --json mergeable` answers
`MERGEABLE` in **both** states, because it reports whether the branches merge cleanly, not whether
you are allowed to merge them.

---

> **The three paragraphs below are history.** They are the 2026-08-04 record and its two corrections,
> kept because the *shape* of each error recurs: both were produced by reading one endpoint and
> concluding about the repository.
>
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
> **What was enforced on 2026-08-30 — superseded 2026-09-03 by #289, see the top of this section.**
> Ruleset **`Branches not to delete`** (id 21859879), enforcement `active`, **no bypass actors**,
> targeting `~DEFAULT_BRANCH`, `main`, `develop` and `release`. It carried exactly two rules:
>
> | Rule | Effect |
> |---|---|
> | `deletion` | those branches cannot be deleted, by anyone |
> | `non_fast_forward` | they cannot be force-pushed, by anyone |
>
> So on that date **destruction was prevented and a failing merge was not.** There was no
> `pull_request` rule, so a direct push to `develop` still landed, and no `required_status_checks`
> rule, so a red run did not block a merge. **For pass/fail the gate remained advisory** — true when
> written, and false since #289 added the other two rules.
>
> **Ratified 2026-08-30, applied 2026-09-03 as #289:** require a pull request, and require the
> **`Lint, test, build`** check (app `github-actions`), on `develop`, `release` and `main`. That makes
> the gate enforcing rather than advisory, and it stops direct pushes to `develop` — accepted as the
> cost.
>
> **The ordering is load-bearing and must not be reversed.** A required check must name a context that
> actually *fires* on the branch it guards. Until #243's trigger fix is merged, a pull request into
> `release` or `main` produces no `Lint, test, build` run at all, so requiring it first would leave
> promotion pull requests waiting forever on a status nobody can produce — the same defect this file's
> *What triggers a run* section documents, arriving from the enforcement side. **Merge the trigger fix,
> confirm a real run on each target branch, then add the rules.** #289 carried that ordering as its
> first criterion and named #243 as its dependency; the run table at the top of this section is that
> criterion discharged.

**The 2026-08-04 record, false since the repo went public — kept for the shape of the mistake.**
*As written then:* branch protection is not configured, and it is not configurable on this
repository. *Measured 2026-08-04:*

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

*As written then:* this gate is therefore advisory, and must never be recorded as "protected". CI
reports on pushes and pull requests, and nothing stops a direct push that fails it. The options, if
that is not good enough later, are: make the repo public, buy GitHub Pro, or add a
`githooks/pre-push` — and a pre-push hook stops the habit, not an adversary, since it lives in one
checkout and `--no-verify` skips it silently.

**The first of those options is what happened.** The repo went public, which made rulesets reachable,
and #289 spent that reachability. The paragraph above is now wrong in its conclusion and right in its
reasoning — which is the reason it is kept rather than deleted: it correctly refused to record an
unenforced gate as "protected", and the sentence only became false when somebody made it false.
