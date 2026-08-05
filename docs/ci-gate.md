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

*Pending.* AC 3 wants a real pipeline run that goes red and is then reverted, which needs a push to a
branch CI watches. The four proofs above are local. This section gets the run URL once the branch is
pushed, and AC 3 stays unticked until then.

## Branch protection — AC 5, and the honest answer

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
