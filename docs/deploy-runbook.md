# Deploy runbook

- Date: 2026-08-04, **executed 2026-08-05**
- Story: #4
- Status: **executed.** Vercel and Supabase accounts exist and are owner-controlled; environment
  variables are set. AC 1 and AC 2 verified on a real phone 2026-08-05 (see §3).
- Production URL: <https://taskr.madcowhq.com> — the custom domain added by #121 on 2026-08-21, and
  the one to publish. The assigned `taskr-khaki.vercel.app` still resolves, still serves the same
  build, and is **not** gated by Standard Protection (see step 6), so the two coexist; the custom
  domain is the published one and the assigned domain is the fallback nobody needs to be moved off.
  <https://taskr-mad-cow1.vercel.app> also resolves, but it is the `<project>-<account>` alias rather
  than a project domain; do not assume any two stay pointed at the same deployment. Confirm with the
  footer's `build <sha>` stamp.

The one prerequisite code cannot discharge: hosting and backend accounts must exist and be
owner-controlled. Free tiers suffice. **Credentials never enter git.**

Steps below are kept in the imperative for anyone repeating this on a new project; what actually
happened on 2026-08-05 is recorded inline, including the two places the original instructions were
wrong.

## 1. Vercel — the front end

1. Sign in at [vercel.com](https://vercel.com) with the GitHub account that owns `SailorDave17/Taskr`.
   Hobby plan; no card required.
2. **Add New → Project**, import `SailorDave17/Taskr`. Private repos are supported on Hobby. (Repos
   owned by a GitHub *organization* are **not** — Taskr is a personal repo, so this is fine.)
3. Vercel should auto-detect Vite. Confirm:
   - Framework preset: **Vite**
   - Build command: `npm run build`
   - Output directory: `dist`
4. **Set the production branch to `release`.** It is **Settings → Environments → Production → Branch
   Tracking**, *not* Settings → Git, where older instructions put it. Read the sentence it prints
   back: *"Every commit pushed to the `<branch>` branch will create a Production Deployment."*

   **Changed 2026-08-12, owner decision, and this is the current setting.** It was `rebuild/v1` from
   2026-08-05 until then, which made **merging a pull request the act of deploying it**. That
   coupling caused the 2026-08-09 outage recorded in `docs/access-model.md` — client code that
   needed an unpasted migration went live automatically — and #62's review found it about to cause a
   second one. Splitting the two branches makes *"the migration is applied"* and *"the client is
   live"* two acts the owner sequences: work merges into `rebuild/v1` and deploys nothing;
   production moves only when `release` does.

   **The promotion step is therefore a pull request from `rebuild/v1` into `release`**, merged by
   the owner after the migrations that branch assumes have been pasted. `githooks/owner-only` lists
   `release` for that reason — a local push to it is refused, because a push to `release` is a
   production release.

   **This step is real and it has been missed once already.** *Measured 2026-08-05*: Vercel had it
   set to **`main`**, so pushes to `rebuild/v1` produced **Preview** deployments and the production
   URL kept serving the import-time build. The correction written earlier that same day — claiming
   Vercel "picked `rebuild/v1` correctly, verified by the first deployment building the exact tip of
   `rebuild/v1`" — was **wrong**, and talked a reader out of the check. The inference does not hold:
   Vercel marks the **import** deployment Production whatever branch it builds, so building the
   right SHA is equally consistent with the production branch being set to something else. One
   observation, two explanations, and the convenient one got written down as verified. **Read the
   setting; do not infer it from a deployment.**

   **That warning applied to the 2026-08-12 change itself, and it is now discharged by measurement
   rather than by assertion.** It is worth reading how, because the sequence is what makes it
   evidence.

   When the setting was first reported, it could **not** be checked: `release` and `rebuild/v1` were
   the *same commit* (`fcabfc7`) and production served `fcabfc7`, so the deployment was
   byte-identical under either setting and no available observation distinguished them — the same
   trap as the two production URLs above, where the distinction lives in a Vercel setting and not in
   any response. There is no Vercel CLI or token on the build machine, so *read the setting* was not
   available either. So it was written down as owner-asserted, with the discriminating observation
   named **in advance**: the first merge into `rebuild/v1` is the test, and production keeping its
   `build <sha>` afterwards is the pass.

   *Measured 2026-08-12, and the prediction was recorded before the event:*

   | | before | after PR #89 merged |
   |---|---|---|
   | `origin/rebuild/v1` | `fcabfc7` | **`d20a809`** — moved |
   | `origin/release` | `fcabfc7` | `fcabfc7` — unmoved |
   | production `build <sha>` | `fcabfc7` | **`fcabfc7`** — unchanged |
   | production asset | `assets/index-DzNO4orx.js` | `assets/index-DzNO4orx.js` — identical |

   **The decoupling is real.** A merge landed on the integration branch, production did not move, and
   the bytes are the same file rather than a rebuild that happened to match.

   **The test subject makes it stronger than a routine pass.** PR #89 is the per-member-auth branch —
   the exact client that cannot be served by a project without `0007`, and the specific near-miss
   that motivated this change. Under the previous arrangement that merge *would have deployed a
   client asking for `members.email` against a live project that does not have it*, which is the
   2026-08-09 outage again. The first real exercise of the mechanism was against the hazard it was
   built for, and it held.

   What remains true regardless: the live app is still the PIN build — because production is built
   from `release`, and that branch has not moved. **`0007` and `0008` were pasted on 2026-08-20**
   (#108), so the first half of the sequence is done and the promotion is what is outstanding. That
   is a **choice with a sequence**, which is the whole point — apply the migration, then promote.
5. Deploy. Note the assigned `*.vercel.app` URL — that is the URL AC 1 is tested against.
6. **Turn Vercel Authentication on, at *Standard Protection*** — Settings → Deployment Protection →
   *Require Log In*, then the deployment-type dropdown that appears beside it. Applied 2026-08-21 by
   #121; the dropdown defaults to *Standard Protection*, which is what is wanted.

   A new Hobby project ships with Deployment Protection **on**, so every URL redirects to
   `vercel.com/login` and nobody but the owner can load the app. This project ran with it **off**
   from 2026-08-05 to 2026-08-21, deliberately: the shell held no data, and #17 scoped that reasoning
   to exactly that condition. #19 retired it once real household records existed.

   **What Standard Protection actually protects — measured, because the documented wording misleads.**
   Vercel describes it as *"protect all except production **Custom Domains** for your project"*, which
   reads as though the assigned `*.vercel.app` production URL is protected by design. It is not.
   Measured 2026-08-21, uncached paths, same second:

   | URL | result |
   |---|---|
   | `taskr.madcowhq.com` — production custom domain | reaches the app |
   | `taskr-khaki.vercel.app` — production assigned domain | **reaches the app** |
   | the production deployment's own `taskr-<hash>-mad-cow1.vercel.app` | `302` to login |
   | any preview deployment URL | `302` to login |

   The exemption follows the **domain**, not the deployment: both production domains are exempt and
   every per-deployment URL is gated, the production deployment's own URL included. On Hobby the
   dropdown offers *Standard Protection* and *All Deployments* (Pro-gated), so there is still **no
   previews-only option**; *Deployment Protection Exceptions*, which would let you name domains to
   exclude, is Pro-only and greyed out.

   **A cached `200` is not evidence.** The first check after the change showed `taskr-khaki.vercel.app`
   answering `200`, which happens to be the right answer for the wrong reason: the headers read
   `x-vercel-cache: HIT` with `age: 23841`, a six-hour-old object that predates the change. Probe a
   path with no cache entry — `/__probe_<random>` — because a protected deployment answers `302` on
   **every** path, so a `404` from the app is what proves you reached it.

   The save has lied convincingly before: on 2026-08-05 the control showed unchecked and *Save* went
   disabled — the signature of success — while a reload showed protection back on, and a second
   identical attempt was needed. It persisted first time on 2026-08-21. **Verify by reloading the
   page and then probing the URLs, never by the form's own state.**

After this, every push to `rebuild/v1` deploys automatically. That is AC 8's "documented, repeatable
pipeline" and it needs no further wiring.

> **Superseded 2026-08-12 — that sentence is no longer true, and the paragraphs below are kept as
> history rather than as instructions.** Production is built from `release`; a push to `rebuild/v1`
> deploys nothing. See step 4 above for the current arrangement and the measurement that confirmed
> it. What survives here undiminished is the *method* — the build stamp, and the rule that a deploy
> is confirmed by reading what the URL serves rather than by trusting a dashboard. That method is
> exactly what proved the 2026-08-12 change, so it is worth reading even though its conclusion has
> moved.

*Status of that claim, 2026-08-05*: **it was false, and the first test caught it.** The project had
exactly one deployment, created by the import at 14:30Z, while the last commit to `rebuild/v1` had
landed at 03:39Z — an eleven-hour gap, so nothing had ever proved that a *push* triggers a deploy,
only that an import does. Those are different mechanisms and only one is the criterion.

PR #15 was merged as that test and **came back negative**: merge commit `ec531b76` landed on
`rebuild/v1`, a deployment fired twelve seconds later, and it was a **Preview** — the latest
Production deployment was still `f7bd3c31` from the import. Root cause was step 4 above. Fixed by
setting Branch Tracking to `rebuild/v1`.

**Verifying it for real needs the build to be observable**, which it was not: a docs-only commit
produces a byte-identical bundle, so a deploy and no deploy look the same from outside. Hence the
build stamp — `VERCEL_GIT_COMMIT_SHA` is mapped into the client bundle by `vite.config.js` and
rendered in the footer as `build <sha>`. Two consequences: the running commit is readable from the
page, and each build gets a distinct `assets/index-*.js` filename, so `curl` alone distinguishes
builds. **Check a deploy landed by reading the stamp, not by trusting the dashboard** — a deployment
record answers about the deployment you asked about, not about what the URL currently resolves to.

## 2. Supabase — the backend

Not needed for the shell to deploy. Do it before **#5** (the roster), which is the first story that
persists anything.

1. Sign in at [supabase.com](https://supabase.com), create a project. Free plan.
2. Record the project URL and the **anon** key from Project Settings → API. The anon key is designed
   to be public *provided row-level security is on* — turn RLS on for every table from the start,
   not later.
3. **Never** put the `service_role` key in the front end or in git. It bypasses RLS entirely.
4. In Vercel → Project Settings → Environment Variables, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

   Only `VITE_`-prefixed variables reach the browser bundle, which is deliberate — anything without
   the prefix stays server-side and is therefore useless to a static SPA. Do not work around that by
   renaming a secret.

   *Done 2026-08-05*: both variables exist, scoped to **Production and Preview**, marked *Sensitive*.
   Development is deliberately unset — local work uses `.env.local`, which `.gitignore` covers.

   **Two things about that setup worth knowing before #5.** First, marking a `VITE_` variable
   *Sensitive* protects it **in the dashboard, not in the product**: Vite inlines the value into the
   client bundle at build time, so the anon key is readable by anyone who views source regardless of
   the badge. That is fine here — the anon key is designed to be publishable — but the protection is
   **RLS**, never the Sensitive flag, so never put a real secret behind a `VITE_` prefix on the
   strength of it. A practical side effect: a Sensitive value cannot be read back, so if a build
   fails to connect you re-enter rather than inspect. Second, **`VITE_` values are inlined at build
   time**, so adding them changed nothing about the deployment already live. Set the variables
   *before* building the first code that reads them, or you get a runtime failure with values that
   look simply absent, no build error, and nothing to suggest the deployment is stale.
5. Free projects **pause after 1 week of inactivity**. See `docs/hosting-decision.md` for what that
   does to scheduled instantiation in #11.

## 3. The provisioning Edge Function

Owner-only, and **separate from every other deploy on this page**: a `git push` rebuilds the front end
and touches nothing here. Until this has run, an organizer who tries to give somebody a sign-in gets a
failure, and nobody but the organizer can sign in at all.

**Every command takes the `npx` prefix, and must run from the repo root.** Both halves of that cost a
round trip on 2026-08-20 and neither is guessable:

- The CLI is not in `package.json` and is not installed globally, so `npx` fetches it per invocation
  and leaves **no `supabase` command on `PATH`**. A bare `supabase login` answers *"is not recognized
  as an internal or external command"*, which reads like a missing login and is a missing binary.
- `functions deploy` reads `supabase/functions/<name>/` **relative to the working directory**, so
  running it from a home directory finds nothing to deploy. `--workdir <repo>` is the alternative to
  `cd`.

```
cd <the repo>
npx supabase login
npx supabase functions deploy provision-member --project-ref <project ref> --use-api
```

Two flags remove two steps that can go wrong. `--project-ref` on the deploy makes a separate
`supabase link` unnecessary. **`--use-api` bundles the function server-side, so Docker is not
required at all** - which is worth stating plainly, because *"Docker's daemon is down on the build
machine"* is the reason this repo recorded, twice, for why the Edge Function was never deployed. An
avoidable dependency had been sitting on record as a blocker.

If the browser flow is awkward - a remote-control session, say - `login` can be replaced with a
personal access token from `supabase.com/dashboard/account/tokens`:

```
set SUPABASE_ACCESS_TOKEN=<token>          cmd.exe
export SUPABASE_ACCESS_TOKEN=<token>       POSIX shell
```

That is session-scoped, and belongs in no file: a token that can deploy to the project is a
credential, and `.env.local` is for values the browser is allowed to see.

The function reads its own secrets from the platform - Supabase injects the project URL, the anon key
and the service-role credential into every function - so there is nothing else to set by hand and
nothing that could end up in git.

**Then prove it, because from the app's side the failure is silent and ambiguous.** A deploy that never
happened, and one that went to a different project, leave the app failing in exactly the same way:

```
curl -i -X OPTIONS https://<project ref>.supabase.co/functions/v1/provision-member -H "Origin: https://<the deployed app>" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization, content-type, apikey, x-client-info"
```

Read **two** things off the answer, not one:

- The status is **200**, not 404. A `{"code":"NOT_FOUND"}` body means the function is not there - and
  it is byte-identical to the answer for a name that never existed, so the status does not tell you
  *which* project answered. The `sb-project-ref` header does.
- `access-control-allow-headers` comes back covering **all four** requested headers. A browser asks
  about every one of them in a single preflight and refuses the request if any is missing, so a list
  covering three works from `curl` and fails from a phone.

The second check is the one nobody writes, and it is the one #112 needed: the gateway's own 404 answer
carries three of the four by itself, which is enough to look healthy at a glance.

**Or just run the check, which asks both questions for you.** Since #115, `npm run check:live` probes
every Edge Function with exactly this preflight:

```
npm run check:live
```

Before a **first** deploy it reads one short, with the Edge Function line failing and the deploy
command inside the failure; afterwards it is green. That makes the transition itself the proof -
there is no state in which the check is green and the function is missing, so nothing here has to be
taken on trust.

Two caveats on reading it that way. On a **redeploy** the check is green on both sides, since it
answers *is a function there and callable* and not *is this the build you just pushed* - use the
timestamp in the dashboard for that. And the count is deliberately not written here: it moves
whenever a table, RPC or function is added, and a number in prose that nothing recomputes is the
defect `check:live` exists to catch, one level up.

## 4. Verifying AC 1 and AC 2

Both **verified 2026-08-05** on the owner's Android phone.

- **AC 1** — open the production URL on a phone **on cellular data with Wi-Fi off**. Wi-Fi would let
  a LAN route succeed and the test would pass for the wrong reason. *Result: the shell loaded with
  no login prompt.*
- **AC 2** — Android Chrome only. The household is single-platform (owner-confirmed at pickup), so
  this AC was shrunk from "Android Chrome and iOS Safari" as the AC's own wording invites. Confirm
  the app launches **standalone** — no browser address bar. The icon should be the three unequal
  bars. *Result: installed and launched standalone.*

  **Correction to this AC's wording.** It says to use **⋮ → Add to Home Screen**. That entry was not
  offered; Chrome showed **Install app** instead, which is the *stronger* signal — Chrome offers
  "Install app" only when a site meets its full installability bar (valid manifest, service worker
  with a fetch handler, HTTPS, correct icons), and falls back to "Add to Home Screen" wording for a
  plain bookmark shortcut when it does **not**. Read literally, the AC names the failure case.
  Judge it by its own parenthetical — *valid manifest plus service worker registration* — which is
  exactly what "Install app" demonstrates.

Server-side checks that support the above, all made against markers only this build produces rather
than against a status code (an auth-walled platform answers `200` from its login page):
`<title>Taskr</title>`, `theme-color #1f6f5c`, `/assets/index-*.js`, `manifest.webmanifest` with
`display: standalone` and all three icons resolving, and `sw.js` served as JavaScript.

One thing that looks like a defect and is not: grepping the main bundle for `serviceWorker` or
`registerSW` finds **nothing**. Registration is injected by `vite-plugin-pwa` as a separate
`<script id="vite-plugin-pwa:register-sw" src="/registerSW.js">` tag in `index.html`. Check there.

If iOS ever joins the household, `apple-touch-icon` and `apple-mobile-web-app-*` meta tags are the
addition needed; they were deliberately left out rather than added speculatively for a platform
nobody owns.

## 5. What you cannot delegate

Steps 1, 2 and 3 create accounts or hold credentials, so they are the owner's. Step 3 needs no
Docker and no `link` - see the flags there - but it does need an access token, which is the part that
cannot be delegated. Everything downstream of
them — wiring the client, the roster schema, RLS policies — is ordinary work in later stories.
