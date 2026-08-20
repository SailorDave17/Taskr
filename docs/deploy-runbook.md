# Deploy runbook

- Date: 2026-08-04, **executed 2026-08-05**
- Story: #4
- Status: **executed.** Vercel and Supabase accounts exist and are owner-controlled; environment
  variables are set. AC 1 and AC 2 verified on a real phone 2026-08-05 (see §3).
- Production URL: <https://taskr-khaki.vercel.app> — this is the domain Vercel lists under
  **Settings → Environments → Production → Domains**, and it is the one to publish.
  <https://taskr-mad-cow1.vercel.app> also resolves and served the same build during setup, but it
  is the `<project>-<account>` alias rather than the assigned production domain; do not assume the
  two stay pointed at the same deployment. Confirm with the footer's `build <sha>` stamp.

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
6. **Turn Vercel Authentication off** — Settings → Deployment Protection → *Require Log In*.
   **This step was missing from the original runbook and it blocks AC 1 completely.**

   A new Hobby project ships with Deployment Protection **on**, so both the generated deployment URL
   and the production alias redirect to `vercel.com/login`. Nobody but the project owner can load
   the app.

   The trap is the setting's name. **Standard Protection does not mean "previews only"** — Vercel's
   own wording is *"Protect all except production **Custom Domains** for your project"*, so the
   generated `*.vercel.app` production URL is protected under it by design. On Hobby the dropdown
   offers only *Standard Protection* and *All Deployments* (Pro-gated); there is **no previews-only
   option**. So the choice is: switch Vercel Authentication off entirely, or add a custom domain.
   This project switched it off — the shell holds no data, and real access control arrives with the
   first persisted record in #5 (RLS plus a household join credential), which is why the ordering of
   those stories matters.

   Note the save is unreliable and lies convincingly: after toggling, the control showed unchecked
   and *Save* went disabled — the signature of success — yet a reload showed protection back on. A
   second identical attempt persisted. **Verify by reloading the page and then loading the public
   URL, not by the form's own state.**

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

## 3. Verifying AC 1 and AC 2

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

## 4. What you cannot delegate

Steps 1 and 2 create accounts and hold credentials, so they are the owner's. Everything downstream of
them — wiring the client, the roster schema, RLS policies — is ordinary work in later stories.
