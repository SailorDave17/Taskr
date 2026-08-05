# Deploy runbook

- Date: 2026-08-04, **executed 2026-08-05**
- Story: #4
- Status: **executed.** Production URL: <https://taskr-mad-cow1.vercel.app>. Vercel and Supabase
  accounts exist and are owner-controlled; environment variables are set. AC 1 and AC 2 verified on
  a real phone 2026-08-05 (see §3).

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
4. **Set the production branch to `rebuild/v1`** — not `main`. Project Settings → Git → Production
   Branch. *Correction, 2026-08-05*: this step was written when the repo default branch was
   `develop`, and warned that Vercel would default to the wrong branch. The default has since been
   changed to `rebuild/v1`, so Vercel picked it correctly with no intervention — **confirm it rather
   than change it**. Verified by the first deployment building `f7bd3c31`, the exact tip of
   `rebuild/v1`.
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

*Status of that claim, 2026-08-05*: **configured but, until this change, never exercised.** The
project had exactly one deployment, created by the import at 14:30Z, while the last commit to
`rebuild/v1` landed at 03:39Z — an eleven-hour gap, so nothing had ever proved that a *push*
triggers a deploy. Merging this runbook correction is itself a commit landing on `rebuild/v1`, so it
is the first real test of the pipeline: confirm a second deployment appears, built from the merge
commit, and that the live URL serves it.

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
