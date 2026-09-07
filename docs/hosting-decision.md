# Hosting and backend decision

- Date: 2026-08-04; extraction platform section added 2026-08-26, phone round-trip measurement
  added 2026-09-07 (both below)
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

## Measured 2026-09-07 — what a phone pays to reach a deployed Edge Function

- Measured by: #205, on the owner's phone (Samsung SM-S918U, Android 16, Chrome-less — `curl`
  8.15.0 in `adb shell`, so nothing is attributable to a browser or a service worker)
- Function: **`provision-member`**
- Deployment: **v8**, deployed 2026-09-04T22:31:12.914Z, `ezbr_sha256`
  **`c7c2e6f4f2afafe5ce05c1948ece9f3fd517228fcbbec26b5e9826ba7f0efd73`**; source last moved by
  commit `dbe6bbd` (2026-08-28). The eszip hash is the SHA that matters here rather than `HEAD` —
  a docs-only commit (this one included) leaves the deployed bundle byte-identical, so a git SHA
  alone cannot place a measurement against a deployment.
- Samples: **314**, every one an HTTP **401**, taken 04:19–06:04 UTC in three passes — two warm
  (over wireless debugging) and one cold schedule of six idle windows (over USB, detached on the
  phone so a dropped cable could not take the schedule with it)
- Raw data: **`docs/phone-latency-2026-09-07.tsv`** — all 314 samples, one row each, so every figure
  below can be recomputed rather than taken on trust. The only redaction is the per-pass public
  egress address, which is this household's broadband and cellular IP and this repo is public; the
  `remote_ip` column is Supabase's Cloudflare edge and is kept.

### What is actually being timed, and the premise that had to be corrected

#205 was filed on the premise that calling the function *with no session at all* refuses **and still
boots the function**, so the refusal would carry cold start. Measured, the first half is true and the
second is not:

| the call | answer | how far it got |
|---|---|---|
| no `Authorization` header | 401 `{"code":"UNAUTHORIZED_NO_AUTH_HEADER"}` | **the gateway. The function never boots.** |
| `apikey:` publishable key only | 401 `{"error":"Sign in first."}` | the function's own first authorization check |
| `Authorization: Bearer <publishable>` | 400 `{"error":"memberId is required."}` | the function, four checks deeper |
| `Authorization: Bearer notajwt` | 401 `{"code":"UNAUTHORIZED_INVALID_JWT_FORMAT"}` | the gateway |

So **there is no way to boot the function without the publishable key** — a header-less call is
refused one hop short of it. That is not a defect; it is the platform declining to spend an isolate
on an unidentified caller. It does mean the credential-free measurement the story imagined would have
timed the gateway and reported it as cold start.

What it buys instead is better than what was asked for: the two refusals differ **only** by whether
the function boots, so running both on the same network seconds apart makes the boot cost a
subtraction rather than an estimate. The two are distinguished per sample by the response body, not
by which one we meant to send — **0 of 254 came back mislabelled**. The other 60 samples are the
reused-connection block, where ten or twenty transfers share one `curl` process and only the
aggregate is captured; those are labelled by construction rather than classified, and the tables say
so by keeping them in their own row.

### Method

Both networks were reached **without touching the phone's state**: `curl --interface rmnet_data1`
egresses over the carrier while wifi stays up and adb stays connected. Binding by interface *name*
works from `adb shell`; binding by source address does not (it times out — the routing rules key on
the output interface). Each pass recorded its own public egress address as the control that the two
columns really are two networks; they differed, as expected, on every pass.

Percentiles are **nearest rank** on the sorted sample, no interpolation. Pass 1 took 24 function
calls against 8 gateway controls, which is a sample size at which the nearest-rank p95 *is the
maximum* — one 6,296 ms cellular outlier duly became "the p95 of transport" and made the
function-minus-gateway p95 come out **negative**. Pass 2 exists for that reason and gives both call
kinds 40 per network, interleaved 1:1 so a radio state change lands in both. The warm tables pool
the two.

Pass 3 is the cold schedule: six sequential 930 s idle windows over USB, run detached on the phone
with `nohup` so a cable or a session could not take it with it, and with the idle **actually slept**
recorded on each sample rather than assumed from the schedule. Its first window credits the 822 s
that had already elapsed since pass 2's last call, so every window is a true 930 s of silence.

### The figures — warm

| network | call | n | p50 | p90 | p95 | min | max |
|---|---|---|---|---|---|---|---|
| wifi | function, fresh socket | 64 | 479 ms | 744 ms | **967 ms** | 259 ms | 1,696 ms |
| wifi | gateway only, fresh socket | 48 | 348 ms | 599 ms | **822 ms** | 200 ms | 1,371 ms |
| wifi | function, connection reused | 28 | 311 ms | 446 ms | 510 ms | 191 ms | 717 ms |
| cellular | function, fresh socket | 64 | 430 ms | 526 ms | **586 ms** | 292 ms | 637 ms |
| cellular | gateway only, fresh socket | 48 | 331 ms | 404 ms | **479 ms** | 220 ms | 6,297 ms |
| cellular | function, connection reused | 28 | 318 ms | 323 ms | 324 ms | 314 ms | 479 ms |

Median breakdown of a fresh-socket call to the function — DNS, TCP, TLS, then the server's own time:

| network | DNS | TCP | TLS | server | total |
|---|---|---|---|---|---|
| wifi | 8 ms | 60 ms | 68 ms | 286 ms | 479 ms |
| cellular | 8 ms | 49 ms | 67 ms | 297 ms | 430 ms |

**Booting and entering the function costs 98–145 ms** — wifi p50 130 ms / p95 145 ms, cellular p50
98 ms / p95 107 ms. It is the most stable quantity in the whole measurement, which is the useful
part: the round trip's variance is the *network's*, not the platform's.

Three things worth carrying:

- **Cellular beat wifi**, on p50 and p95 and on every percentile between. This household's wifi is
  the slower and far more variable path (max 1,696 ms against cellular's 637 ms), so **cellular is
  not the pessimistic case** and a verdict that assumes it is will be assuming the wrong thing.
- **The single worst sample, 6,297 ms, was 6,028 ms of DNS** on a cellular call — a resolver stall
  on a radio waking up, not a slow round trip to Supabase. It is real latency a member would feel,
  and it is also not a fact about the hosting choice. It is excluded from the p95 by rank, not by
  hand; at n=8 it *was* the p95, which is what pass 2 was for.
- **A connection already open costs ~311–318 ms** and is nearly free of variance on cellular
  (p50 318, p95 324, a 10 ms spread across 28 samples). That is the floor: DNS, TCP and TLS are a
  quarter to a third of a fresh-socket call (168 ms of 479 on wifi, 112 ms of 430 on cellular), and
  a client that keeps a connection alive pays the floor instead.

### The figures — cold

Six idle windows, alternating network, each preceded by **930 s during which nothing called the
function from anywhere**. Each window fires a gateway-only control first — refused one hop short of
the function, so it times that instant's network *without* warming the isolate — then the cold call,
then three warm calls seconds later on the same network. The last of those is the instrument that
matters: it makes the cold penalty a **within-window subtraction** rather than a comparison against
a warm figure from earlier in the night, when the network was a different network.

| network | idle | control | **cold** | median of the 3 warm seconds later | cold penalty |
|---|---|---|---|---|---|
| wifi | 930 s | 441 ms | **675 ms** | 448 ms | **+227 ms** |
| cellular | 930 s | 655 ms | **797 ms** | 540 ms | **+257 ms** |
| wifi | 930 s | 529 ms | **605 ms** | 425 ms | **+180 ms** |
| cellular | 930 s | 547 ms | **634 ms** | 372 ms | **+262 ms** |
| wifi | 930 s | **2,444 ms** | **1,397 ms** | 627 ms | +770 ms |
| cellular | 930 s | 761 ms | **652 ms** | 390 ms | **+262 ms** |

**Fifteen minutes is enough to evict the isolate — the boot is real and it is small.** On cellular the
penalty reproduces to under 5 ms across three independent windows (257.0, 261.5, 261.7 ms); on wifi
it is 227 and 180 ms in the two windows where the network behaved. So **a cold start costs roughly
180–260 ms**, which is about the same order as the TLS handshake in front of it.

Two things this table is careful about:

- **The 770 ms wifi outlier is the network, not the boot.** That window's *control* — which cannot
  boot anything — read **2,444 ms**, higher than the cold call it preceded. Wifi was degraded for
  those few seconds, and the per-window control is the only reason that is visible rather than being
  banked as the worst cold start of the night.
- **There is no cold p95, and one should not be quoted.** At n=3 per network the nearest-rank p95 *is*
  the maximum — the same trap pass 1 fell into at n=8. The maxima are wifi **1,397 ms** and cellular
  **797 ms**, and they are stated as maxima. Cold p50 is 675 ms (wifi) and 652 ms (cellular), against
  warm p50s of 479 and 430.

### Against the 3000 ms deployed-path kill number (epic #217)

The kill condition is p95 ≤ 3000 ms **on the deployed path**. What #205 measures is everything on
that path *except the endpoint's own work and the provider call* — so this is the toll, and the
remainder is the budget the extraction call has to fit into.

| network | case | what the round trip costs | share of 3000 ms | left for the endpoint and the provider |
|---|---|---|---|---|
| wifi | warm, p95 | 967 ms | 32.2% | **2,033 ms** |
| cellular | warm, p95 | 586 ms | 19.5% | **2,414 ms** |
| wifi | **worst cold observed** | **1,397 ms** | **46.6%** | **1,603 ms** |
| cellular | worst cold observed | 797 ms | 26.6% | 2,203 ms |
| wifi | transport alone, no boot, p95 | 822 ms | 27.4% | 2,178 ms |
| cellular | transport alone, no boot, p95 | 479 ms | 16.0% | 2,521 ms |

**Read the wifi rows.** Warm, roughly a third of the budget is gone before the extraction endpoint
executes a line, and about 85% of that third is transport the platform choice does not control.
**The number to design against is the cold one: 1,603 ms.** That is the worst case actually observed
rather than a projection — and it is a member's first request after a quiet spell, which is exactly
when somebody sits down to describe their week.

The cold penalty itself is only ~180–260 ms of that. The rest of the gap between 967 ms and 1,397 ms
is this household's wifi having a bad second, which no hosting decision fixes.

### What this does not measure

**It is not the extraction endpoint.** `provision-member` refuses at its first authorization check,
so what is timed is the platform's part of the path — reaching the region, booting an isolate,
entering the handler — and nothing of the endpoint's own work or the provider call. That is the point:
this is the toll, and #206/#207 spend the remainder. Re-check the combination at the extraction
endpoint's own deploy, as #205's filing gate said; **the direction of the error here is conservative**
because the extraction isolate will be larger than this one and may boot slower.

**It is one household's wifi and one carrier, on one evening.** The wifi column is the noisy one and
its worst readings are the local link, not the platform — a second household would produce different
wifi numbers and much the same cellular ones. The stable quantities, and the ones worth carrying
forward, are the boot penalty (~180–260 ms), the entry cost (98–145 ms) and the reused-connection
floor (~311–318 ms). All three are properties of the platform rather than of this flat.

**A cold sample is only cold if nothing else called the function.** Six windows held that here, on the
owner's say-so that no roster action would land. A repeat should assume it can be broken silently: a
`provision`, `reset` or `revoke` from any device ends a window, and nothing in the data would say so
except a cold sample that looks warm.

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
