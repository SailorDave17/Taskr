# Hosting and backend decision

- Date: 2026-08-04; extraction platform section added 2026-08-26 (see below)
- Decided by: owner (SailorDave17), at pickup of story #4
- Status: decided; provisioned 2026-08-05 (see *What is not done*, kept as the 2026-08-04 record)
- Sources: vendor pricing/limits pages, fetched 2026-08-04 — links at the bottom

## The decision

| Layer | Chosen | Alternative considered |
|---|---|---|
| Front end hosting | **Vercel** (Hobby) | Cloudflare Pages, Netlify, GitHub Pages |
| Backend / database | **Supabase** (Free) | Firebase |

## Why Supabase over Firebase

Taskr's core operation is arithmetic over time budgets: total available minutes, minutes already
committed, minutes remaining, and an allocation proportional to what is left. That is relational
work with a real consistency requirement — two phones completing chores at once must not both read
the same "remaining" figure and both write against it.

- **Postgres fits the domain.** The budget arithmetic is joins and aggregates over a small set of
  related tables. Firebase's NoSQL modelling would push that into denormalised documents and
  application-side reconciliation, on exactly the numbers the product's fairness claim rests on.
- **Row-level security fits the access story.** Household scoping becomes a policy on the table
  rather than a rule enforced in every query. Firebase security rules are the analogue but are
  harder to audit and cannot express joins.
- **Transactions are first class.** See the concurrency section below — two later stories have ACs
  that turn on this.

**What Firebase would have been better at**, honestly: its offline SDK is materially stronger. If the
household turns out to use Taskr in places with no signal, that advantage is real and this decision
should be revisited rather than defended. Nothing here is hard to reverse at this stage — the shell
ships with no backend client wired in.

## Why Vercel

Deploy-on-push to `rebuild/v1` falls out of the GitHub integration with no pipeline to write, which
is precisely what AC 8 asks for ("a documented, repeatable command or pipeline — not a one-off manual
upload"). Cloudflare Pages and Netlify would both serve; Vercel wins on the least configuration for a
Vite/React SPA.

**GitHub Pages was ruled out**, not merely passed over: Taskr is a **private** repo, and Pages on a
private repo requires a paid plan. It also has no server-side environment-variable injection, which
the Supabase client will need.

## Free-tier limits that constrain later stories

These are the numbers later stories must be designed against, not aspirations.

### Scheduled functions — feeds the recurrence stories (#11 → #53, shipped that way)

`pg_cron` **is available on the Supabase free plan**, so template instantiation could have been
scheduled in the database rather than needing an external trigger.

**But the constraint that actually bites is this:** free Supabase projects are **paused after 1 week
of inactivity**, and a paused project's Postgres instance is stopped — so its cron jobs stop with it.
For a household app this is a live risk, not a theoretical one: a week away and the schedule silently
stops. **Instantiation must not assume the scheduler ran.** *(This section said "#11" when it was
written; #53 superseded #11 and then shipped exactly this design on 2026-08-24 — no pg_cron at all,
a client-triggered catch-up pass (`catch_up_repeats`, migration `0012`) that is idempotent and
catch-up-capable, safe to run late and safe to run twice, with the exactly-once rule held by a
unique index rather than by the code. The analysis above is why; it is cited in #53's own "Why this
shape".)*

Vercel also offers cron jobs (100 per project on Hobby) as a fallback trigger, which would keep the
Supabase project warm as a side effect. Note that is a *workaround for the pause*, and calling it
that in the code beats discovering it later as folklore.

### Auth for members without email — feeds the roster story (#5)

*(Superseded twice since this was researched: #62 moved every member to a real per-member auth
user — a synthetic `@taskr.invalid` address for people without email — and #246 then **disabled
anonymous sign-ins on the project entirely**, nothing needing them any more. The platform facts
below stay as the record of what was weighed in 2026-08-05; do not build on them.)*

**Anonymous sign-ins are supported on the free plan**, and they exist for exactly this case: an
authenticated session with no email, no password, and no PII. A child joins the household without an
email address, and if they later get one the anonymous user can be *converted* — the user id is
preserved, so their history carries over. That is the mechanism #5 should build on.

Three limits to design against:

- Anonymous users **count toward the MAU quota** once authenticated. The quota is 50,000/month, so
  for a household this is irrelevant — recorded only so nobody re-derives it.
- Anonymous sessions expire after **30 days of inactivity**, after which the user gets a new id. For a
  child who uses the app weekly this is fine; for a rarely-active member it means their identity can
  silently change. **#5 should key household membership to a row the household owns, not to the auth
  id alone.**
- An IP-based rate limit of **30 requests/hour** applies to anonymous sign-in, adjustable in the
  dashboard. A whole family behind one home NAT shares that IP — worth remembering if onboarding
  several people in one sitting fails oddly.

This also touches the privacy question the grooming note parks before #5: anonymous sign-in means
children can use Taskr **without an email address ever being collected**, which is the strongest
available answer to "what of the kids' data leaves the house". That is a reason to prefer it beyond
convenience.

### Transactional / atomic writes — feeds #9 (allocator concurrency) and #11 (idempotency)

Postgres gives full ACID transactions. For multi-statement atomic work, the pattern is a Postgres
function invoked via `rpc()`, which runs server-side in a single transaction — so the allocator can
read remaining budgets and write assignments without another device interleaving. `SELECT … FOR
UPDATE` is available where row locking is the better fit, and unique constraints give idempotency
by construction for #11's "instantiate once per date" requirement.

**This is the strongest single reason for Supabase over Firebase** and the one that would be most
expensive to work around later.

### The other numbers, for reference

| Supabase Free | | Vercel Hobby | |
|---|---|---|---|
| Database | 500 MB | Deployments/day | 100 |
| Egress | 5 GB (+5 GB cached) | Build time/deployment | 45 min |
| File storage | 1 GB | Fast data transfer | 100 GB |
| Monthly active users | 50,000 | Concurrent builds | 1 |
| Edge function calls | 500,000 | Cron jobs/project | 100 |
| Active projects | **2** | Projects | 200 |
| Inactivity pause | **1 week** | | |

Two of these are small enough to plan around rather than ignore:

- **2 active Supabase projects** means a separate staging database costs you the only spare slot.
  Decide deliberately in #4's follow-up rather than discovering it when you want one.
- **Vercel Hobby cannot connect to repos owned by a Git *organization*.** `SailorDave17/Taskr` is a
  personal repo, so this is fine — recorded because it silently blocks the import flow if the repo
  ever moves to an org.

## Ratified 2026-08-26 — the extraction call runs on Supabase Edge Functions

- Ratified by: owner (SailorDave17), 2026-08-26, at the filing gate of the extraction-bet
  grooming run (`wf_d7976608-913`; epic #217)
- Recorded here by #201, whose purpose is that no story is written against the premise that this
  decision is still open

**The LLM extraction call runs in a Supabase Edge Function.** The choice was first taken at the
2026-08-06 grooming (recorded in `docs/refresh-charter.md`'s decision log) and ratified 2026-08-26,
by which point it was no longer hypothetical: **this repo already ships two deployed Edge
Functions** — `provision-member` and `calendar-connect` — with a committed deploy script
(`npm run deploy:function`), a CORS test and a live probe in `check:live`. The extraction endpoint
(#208, deployed by #209) joins an existing surface rather than creating one.

**Rejected alternatives, and why:**

- **Vercel Serverless functions** — a second deployment surface and a second secret store, for no
  benefit the tree suggests. The Supabase auth context already exists at the Edge Function, the
  secret sits next to the data, and one platform holds credentials.
- **A client-side provider key** — the `VITE_` secret-key defect wearing a different hat. A secret
  in the bundle is public; `src/lib/keyShape.js` exists because a secret key reached a published
  bundle once already, and the build now refuses one.

## What is not done

*(The 2026-08-04 record. Done 2026-08-05 — both accounts exist and the app has deployed against
them since; see `docs/deploy-runbook.md`. Kept because the constraint list above is still what
later stories design against.)*

The accounts do not exist yet (owner-confirmed at pickup). Everything above is a decision and a
constraint list; nothing is provisioned. The account steps are in `docs/deploy-runbook.md`, and ACs
1, 2 and 8 of #4 stay unticked until they are followed.

**Credentials never enter git.** Supabase's URL and anon key are set as `VITE_`-prefixed environment
variables in the Vercel dashboard. `.gitignore` covers `.env` and `.env.*`.

## Sources

- [Supabase pricing](https://supabase.com/pricing)
- [Supabase Cron / pg_cron docs](https://supabase.com/docs/guides/cron)
- [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Vercel limits](https://vercel.com/docs/limits)
