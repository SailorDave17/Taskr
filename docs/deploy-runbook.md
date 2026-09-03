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

   **The promotion step is therefore a pull request into `release`**, merged by the owner after the
   migrations that branch assumes have been pasted. `githooks/owner-only` lists `release` for that
   reason — a local push to it is refused, because a push to `release` is a production release.

   **Changed again 2026-08-27: the source branch is `develop`, not `rebuild/v1`.** The repo's GitHub
   default branch moved to `develop` the same day, and story PRs go there too now — see *Branching*
   in the README. `rebuild/v1` retired; every commit it ever carried is an ancestor of `develop`
   (measured: `git merge-base --is-ancestor origin/rebuild/v1 origin/develop`), so nothing below this
   paragraph needed rewriting to account for it — the mechanics of the `release` promotion are
   unchanged, only which branch it promotes *from*.

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
   - `VITE_GOOGLE_CLIENT_ID` — **since #95, and only once section 3b has produced one.** The client
     **ID**, which ends `.apps.googleusercontent.com`. Its sibling the client secret begins
     `GOCSPX-` and must never go here or in any other `VITE_` variable; the build refuses if it
     sees one, and the refusal names the Google console. Without this variable the app runs and the
     Connect button says so, which is a deliberate state — see 3b.

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
5. **Authentication → URL Configuration. Set `Site URL` to the production origin** — the deployed
   app's own URL, e.g. `https://<the deployed app>`. **Do not leave it at the factory default**,
   which is `http://localhost:3000`.

   This step did not exist on this page until **#129**, and its absence is the root cause of a live
   failure rather than a tidiness point. *Measured 2026-08-21*: the field was still
   `http://localhost:3000`, untouched since the project was created on 2026-08-05, and an organizer
   clicked a real confirmation email and landed on a dead page. A probe with a deliberately invalid
   token reproduced it exactly:

   ```
   GET https://<project ref>.supabase.co/auth/v1/verify?token=deliberately-invalid-probe&type=signup

   303 See Other
   Location: http://localhost:3000#error=access_denied&error_code=otp_expired&…
   ```

   Nothing in this repo could have caught it. It is a dashboard field, and every check was green
   for the sixteen days it was wrong — which is why it is a numbered step here and not a caution.

   **Also set `Redirect URLs`** to the production origin and the local dev origin
   (`http://localhost:5173`, Vite's default). **Preview origins are deliberately excluded** — #121
   put Vercel previews behind Standard Protection, and adding `*.vercel.app` here would make a
   deliberately walled-off surface a sanctioned auth redirect target. The same decision is recorded
   at the call site in `src/lib/household.js` (`confirmationRedirectTo`); the two are one decision
   seen twice, so change both or neither.

   **The ordering hazard, which is the part that costs an hour if it is not known:** a confirmation
   email's `redirect_to` is fixed **at send time**, baked into the link when the mail goes out.
   Correcting `Site URL` afterwards does **not** repair links already in an inbox — those still
   point where they pointed. The person has to request a fresh email. So set this **before** the
   first signup, and after any correction assume every outstanding link is still broken.

   Since **#129** the app also passes `emailRedirectTo` from the running origin at the call site, so
   a signup driven from `npm run dev` comes back to the dev server rather than to production. That
   makes the value checkable in code rather than only in a dashboard — but it does not replace this
   step: the redirect must still be in `Redirect URLs` to be honoured, and anything the app does not
   pass a value for still falls back to `Site URL`.
6. Free projects **pause after 1 week of inactivity**. See `docs/hosting-decision.md` for what that
   does to scheduled instantiation in #11.

## 3. The Edge Functions

**Two of them since #95** — `provision-member` and `calendar-connect`. `npm run deploy:function`
deploys both; `npm run deploy:function -- <name>` narrows it to one, and a name this repo does not
have is refused by the script rather than handed to the CLI, which would fail with a message about a
directory and send you to look at the filesystem instead of at what you typed.

Owner-only, and **separate from every other deploy on this page**: a `git push` rebuilds the front end
and touches nothing here. Until `provision-member` has run, an organizer who tries to give somebody a
sign-in gets a failure, and nobody but the organizer can sign in at all. Until `calendar-connect` has,
the Connect Google Calendar button on the capacity screen fails when it is pressed.

**A source change to an Edge Function needs a deploy of its own, and `npm run check:deployed`
reports when one is owed.** Merging does not deploy a function, and neither does pasting a migration —
those are the other two acts on this page that make production move, and it is easy to assume one of
them carries this. `supabase/functions/**` reaches production only when `npm run deploy:function`
runs, as a separate act — and since #222 the omission is a red check rather than something somebody
has to remember. *(This paragraph said "nothing in this repo will tell you it is owed" until #222,
and it was true.)*

*Measured 2026-08-27 (#196), which is why this is a paragraph and not a caution:* #161 changed the
source of both functions and merged at 02:12Z. Production went on serving the 2026-08-24 build, and
**`npm run check:live` read 24 of 24 green throughout — before the redeploy and after it,
identically, with the excused-red set empty and correct both times.** Every instrument in this repo
agreed that everything was fine while both fixes were absent from production.

**`npm run check:deployed` reports the omission.** `check:live` asks whether a
function is *there and callable*, which the superseded build answers just as well, so it is blind to
this by construction rather than by oversight — and its blindness is invisible, because a green run
is what a correctly deployed project looks like too. What is not blind is the platform's own record,
and since #222 a script reads it: `check:deployed` compares each function's deployed `updated_at`
against the last commit touching its source and **exits non-zero when a deploy is older**, naming
`npm run deploy:function` as the fix. It needs `SUPABASE_ACCESS_TOKEN`; the same record reads by
hand, with no token beyond a CLI login, as

```
npx supabase functions list --project-ref <project ref>
```

*(This paragraph opened "No check here can report the omission. One command outside here can" until
#222, and it was true — the command above was the only instrument, held as prose. A command in prose
is the failure `scripts/deploy-function.mjs`'s header records this repo paying for twice, so #222
applied the same repair to the check that #112 applied to the deploy.)*

Read three fields. `version` and `updated_at` say a deploy happened; **`ezbr_sha256` is the hash of
the deployed bundle**, and it is the one that matters, because it separates *a deploy happened* from
*a deploy happened and the code was different*. Compare `updated_at` against the merge time of the
commit that changed the source: if the deploy is older, it is owed — the comparison `check:deployed`
automates, per function, against the last commit touching that function's directory. On #196 both functions moved a
version and both hashes changed, and that pair is the only evidence anywhere in that story that the
fixes are actually running.

*The hash is content-addressed, and that was measured rather than assumed* — a claim about an
instrument is worth exactly what its control is worth. Redeploying `provision-member` a second time
from **byte-identical** source moved it v5 to v6 and left `ezbr_sha256` **unchanged**, while
`calendar-connect`, untouched in that round, held both its version and its hash. So `version` and
`updated_at` answer *did a deploy happen*, and only `ezbr_sha256` answers *was the code different*.
Had the hash moved on the identical redeploy it would have been a per-deploy build id, and the
sentence above would have been false.

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
npm run deploy:function
```

That script is the supported form and it is what the rest of this section describes; the raw command
it runs, per function, is below because the flags are worth understanding rather than because you
should type them.

```
npx supabase functions deploy <name> --project-ref <project ref> --use-api
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

`provision-member` reads its own secrets from the platform - Supabase injects the project URL, the
anon key and the service-role credential into every function - so there is nothing to set by hand for
it and nothing that could end up in git.

**That sentence used to say "the function", full stop, and #95 made it false.** `calendar-connect`
needs two secrets Supabase does not inject, because they belong to Google rather than to this
project: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Section 3b is where they come from, and the
function refuses by name when they are missing rather than saying a bare "not configured" — because
the three Supabase ones are always there, so an unqualified message would send you to check the
wrong half.

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
answers *is a function there and callable* and not *is this the build you just pushed* -
`npm run check:deployed` answers that second question, and section 3 above says which three
fields it reads. And the count is deliberately not written here: it moves
whenever a table, RPC or function is added, and a number in prose that nothing recomputes is the
defect `check:live` exists to catch, one level up.

## 3b. The Google OAuth client, for the calendar connection

Owner-only, and **the one step that cannot be done from a session** — it needs a Google account and a
Google Cloud project, and step 2's test-user dialog fails silently from an automated browser even
with the owner signed in (see the warning there). Until it has run, the Connect Google Calendar button on the capacity screen
reaches an Edge Function that refuses with *"This function is not configured: GOOGLE_CLIENT_ID,
GOOGLE_CLIENT_SECRET are not set."* Naming them is deliberate: Supabase injects its own three secrets
into every function, so a bare "not configured" would send you to check the wrong ones.

1. In [console.cloud.google.com](https://console.cloud.google.com), create a project (or reuse one)
   and enable the **Google Calendar API**.
2. Configure the OAuth consent screen. **External**, and it may stay in *Testing* — a household is
   under the 100-user test-user cap, so there is no verification review to sit through. Add each
   member who will connect a calendar as a test user; a member who is not listed is refused by
   Google with a message about the app not being verified.

   **Adding a test user is a hand step, in an ordinary browser.** From an automated browser, the
   **Audience → Add users** dialog's Save silently does nothing: the chip commits, Save is enabled
   and clicked, and **no network request is issued** — no error, no toast, and the list still reads
   `No rows to display` after a reload. Measured five times across two sessions in
   [#142](https://github.com/SailorDave17/Taskr/issues/142); the identical dialog works by hand.
   There is no way around it: the console's write route for this list
   (`TrustedUserList`) appears nowhere in its loaded bundles, no public Google API exposes OAuth
   test users, and `gcloud` has no surface for them either. So when this step looks done from a
   session, it is not — recognise the silent-Save failure instead of re-diagnosing it, and do the
   step by hand.

   **Check the result by reading the state back, never from the dialog** — it reports success
   either way. Two reads, both recorded in #142:
   - **Reload the Audience page**: the member appears under Test users. The reload is the
     criterion; the pre-reload list is the dialog's own rendering.
   - **The consent probe**: open the consent URL the app itself builds (press Connect Google
     Calendar, or build the authorize URL with `prompt=consent`, which renders and grants
     nothing). An unregistered member gets Google's `access_denied` page — *"The developer hasn't
     given you access to this app"* — and a registered one gets the consent screen. This asks the
     system that enforces the list, so it is evidence in a way no listing is.
3. Create an **OAuth 2.0 Client ID**, type **Web application**, and add both of these as
   **Authorized redirect URIs** — exactly, with the trailing slash:
   - `https://taskr.madcowhq.com/`
   - `https://taskr-khaki.vercel.app/`

   The app builds its redirect address from `location.origin`, so whichever host the member opened
   is the one Google is asked about. A host that is not on this list is refused **by Google**, on a
   page naming the address, which is the loud failure worth having.
4. Copy the two values, and keep them apart — this is the step the build guard exists for:

   | Value | Looks like | Where it goes |
   |---|---|---|
   | Client **ID** | `…apps.googleusercontent.com` | Vercel, as `VITE_GOOGLE_CLIENT_ID` (§2 step 4) |
   | Client **secret** | `GOCSPX-…` | Supabase function secrets, below. **Never** a `VITE_` variable |

   They sit a few lines apart on the same Google console screen and get pasted in the same sitting.
   Putting the secret in `VITE_GOOGLE_CLIENT_ID` produces a **working build** that publishes a
   credential to anyone who views source — so `src/lib/keyShape.js` refuses the build outright, and
   the message names the Google console rather than the Supabase one. *Measured 2026-08-24*: a
   planted `GOCSPX-` value fails `npm run build` with exit 1; a real client ID builds clean.
5. Set the function secrets (not `.env.local`, which is for values the browser is allowed to see):

   ```
   npx supabase secrets set GOOGLE_CLIENT_ID=<the client id> GOOGLE_CLIENT_SECRET=<the secret> --project-ref <project ref>
   ```

   These are the FIRST hand-set function secrets this project has. `provision-member` needed none,
   because Supabase injects the project URL, the anon key and the service-role credential into every
   function — so "the function reads its own secrets from the platform" was true until #95 and is
   not any more.
6. Then set `VITE_GOOGLE_CLIENT_ID` in Vercel and **redeploy**. `VITE_` values are inlined at build
   time, so the variable alone changes nothing about the deployment already live.

**What proves it, and what does not.** `npm run check:live` answers *is `calendar-connect` deployed
and callable by a browser* — it does not and cannot answer *are its Google secrets set*, because a
preflight carries no body and invokes nothing. The first real connection is the proof, and it is
[#100](https://github.com/SailorDave17/Taskr/issues/100)'s job rather than this page's.

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

**So is §3b step 2's test-user addition, for a different reason.** It is not about accounts or
credentials: the Google console's Add-users dialog does not submit from an automated browser — Save
issues no network request at all — and no API reaches that list, so the write can only be made by
hand in an ordinary browser and confirmed by read-back (§3b step 2 names the two checks; measured
in [#142](https://github.com/SailorDave17/Taskr/issues/142)).

### Pasting a migration, and reading the catalog back — the two routes (#150)

**Both routes are built, and neither replaces the other.** The condition that picks between them is
whether a person is present, not which is newer — so read the two headings as a question about the
run you are in, and see the table at the foot of this section.

**Route A, the browser — for an attended session.** With the owner signed in to the Supabase
dashboard in the automated browser, a session can open the SQL editor, set the editor's contents and
run them. *Measured 2026-08-26 (#150)*: `window.monaco.editor.getEditors()[0].setValue(sql)` then
`Ctrl+Enter`, results read out of the page.

Two things it is good for, and one it is not:

- **Confirming a paste that no client-side instrument can see.** `check:live` reads what the client
  reads, so a grant of a privilege the role already holds is invisible to it — that is the whole of
  `0013`. `pg_attribute.attacl` and `pg_class.relacl` say plainly what was granted and by which
  statement, and this route reaches them where PostgREST cannot (`information_schema` is not
  exposed). The measurement is in `docs/access-model.md`.
- **Checking a paste arrived intact.** A saved snippet's character count, compared against the repo
  file's, catches a truncated or transcoded payload. *Measured*: `0013` at 6761 characters plus 120
  carriage returns is exactly the 6881 the editor held, all 8 non-ASCII characters intact; `0014`
  likewise at 7846. A clipboard can re-encode a file on this machine, so this is not ceremony.
- **It is no use unattended.** It needs a live signed-in dashboard session in that browser, so it
  serves an attended session and no cron, CI job or headless run. That is what Route B is for.

**Route B, a Supabase personal access token against the Management API — for an unattended run.**
Built by **#185**. It makes the paste and the catalog probe ordinary commands:

```
npm run migrate:live supabase/migrations/0017_something.sql
npm run migrate:live supabase/migrations/0017_something.sql -- --dry-run
npm run probe:live-grants
```

Both need `SUPABASE_ACCESS_TOKEN` and **refuse by name without it**, never falling back to the anon
key sitting in the same file. `--dry-run` needs no credential at all: it prints the project it
derived, the statement count and the file's digest, and sends nothing — which is the cheap way to
see what a command would do before deciding to hold a token.

What each is good for:

- **`migrate:live` proves the payload arrived, from the far end.** Route A's character-count check
  is the one thing about it that cannot be delegated to a person reliably, because it is the step
  that is easy to skip when the paste *looks* fine. This one asks Postgres for the length, byte
  count and md5 of what it received, compares them against the file on disk, and **applies nothing
  if they disagree**. A file compared against itself would prove nothing at all.
- **`probe:live-grants` reads the catalog that `check:live` cannot reach**, reconciles it against
  what #150 measured on 2026-08-26, and exits non-zero on a difference. It carries a negative
  control — `chores.repeat_since`, which `0012` grants to nobody — because a probe reporting grants
  everywhere cannot report an absence.
- **It runs with nobody watching**, which is the whole reason it exists: a cron job, a CI step, or a
  session with no browser.

**The cost, which is why this was a separate decision and not a widening of #150.** A personal
access token authenticates as the ACCOUNT, not as a project. It has full authority over every
project in the account and can create, pause and delete them — there is no row-level security in
front of it and no policy that limits it. It is the only credential of that class this repo has ever
needed.

So: **it is never committed.** `.gitignore` keeps `.env.local` out of git, and `src/test/gate.test.js`
scans every file in the repo — tracked and untracked — for a token-shaped literal and fails the
build on one. **Revoke it** at <https://supabase.com/dashboard/account/tokens>, which is immediate
and free: do so the moment a one-off use is finished, or at once if it has been pasted anywhere that
is not `.env.local`, or if you are simply unsure. Minting another takes ten seconds. `.env.example`
carries the same instructions beside the variable.

**Which route to use**

| | Route A — browser | Route B — token |
|---|---|---|
| Needs | a signed-in dashboard session | `SUPABASE_ACCESS_TOKEN` |
| Runs unattended | no | yes |
| Credential | the owner's live session | account-wide, long-lived |
| Payload checked | by hand, character counts | automatically, before applying |
| Arbitrary SQL | yes — it is an editor | no, by construction |

Route A can run any statement, which makes it the one to reach for when the task is genuinely
exploratory. Route B deliberately cannot: it applies a named file from `supabase/migrations/` or
reads the catalog, and nothing else. That narrowness is the point rather than an unfinished edge —
the general command is exactly what a token of this authority makes easy and what #185 argued
against building.

**What is still the owner's either way: deciding to paste.** Neither route changes that a migration
reaching the live project is a deliberate act with a sequence — apply, then promote.
