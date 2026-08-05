# Deploy runbook

- Date: 2026-08-04
- Story: #4
- Status: **not yet executed** — the accounts below do not exist. ACs 1, 2 and 8 of #4 are unticked
  until they do.

The one prerequisite code cannot discharge: hosting and backend accounts must exist and be
owner-controlled. Free tiers suffice. **Credentials never enter git.**

## 1. Vercel — the front end

1. Sign in at [vercel.com](https://vercel.com) with the GitHub account that owns `SailorDave17/Taskr`.
   Hobby plan; no card required.
2. **Add New → Project**, import `SailorDave17/Taskr`. Private repos are supported on Hobby. (Repos
   owned by a GitHub *organization* are **not** — Taskr is a personal repo, so this is fine.)
3. Vercel should auto-detect Vite. Confirm:
   - Framework preset: **Vite**
   - Build command: `npm run build`
   - Output directory: `dist`
4. **Set the production branch to `rebuild/v1`** — not `main`. This is the step most likely to be
   missed, because Vercel defaults to the repo's default branch, and `main` currently holds the
   legacy tree plus the charter. Project Settings → Git → Production Branch.
5. Deploy. Note the assigned `*.vercel.app` URL — that is the URL AC 1 is tested against.

After this, every push to `rebuild/v1` deploys automatically. That is AC 8's "documented, repeatable
pipeline" and it needs no further wiring.

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
5. Free projects **pause after 1 week of inactivity**. See `docs/hosting-decision.md` for what that
   does to scheduled instantiation in #11.

## 3. Verifying AC 1 and AC 2

- **AC 1** — open the production URL on a phone **on cellular data with Wi-Fi off**. Wi-Fi would let
  a LAN route succeed and the test would pass for the wrong reason.
- **AC 2** — Android Chrome only. The household is single-platform (owner-confirmed at pickup), so
  this AC was shrunk from "Android Chrome and iOS Safari" as the AC's own wording invites. Use
  **⋮ → Add to Home Screen**, then confirm the app launches **standalone** — no browser address bar.
  The icon should be the three unequal bars.

If iOS ever joins the household, `apple-touch-icon` and `apple-mobile-web-app-*` meta tags are the
addition needed; they were deliberately left out rather than added speculatively for a platform
nobody owns.

## 4. What you cannot delegate

Steps 1 and 2 create accounts and hold credentials, so they are the owner's. Everything downstream of
them — wiring the client, the roster schema, RLS policies — is ordinary work in later stories.
