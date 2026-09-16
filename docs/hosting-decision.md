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

**Amended 2026-09-11, #430 — one scheduled job now exists, by owner decision, taken knowingly
against both this section and the Vercel Serverless rejection below.** It is a once-daily Vercel
cron (`vercel.json`) calling `api/purge.js`, which calls the `purge-deleted-households` Edge Function
with a shared secret. That function purges households whose seven-day deletion grace period has
ended.

- **Why a privacy purge is the exception.** A grace period promises that deleted data goes when it
  ends *even if nobody returns*. The client-triggered pattern above can keep that promise only while
  somebody still uses the app, and repeating chores never needed that guarantee.
- **What it costs, stated rather than discovered:**
  - It is the second deployment surface and second secret store the rejection below warned about.
    Vercel holds `CRON_SECRET` and `PURGE_SHARED_SECRET`, and **never** the Supabase service key,
    which stays with the Edge Function.
  - Vercel Hobby runs a cron at most daily, anywhere within the hour, and never retries a failure.
  - Hobby keeps logs for one hour, so the purge records every run in `household_purge_runs`.
  - Crons run only on the production deployment, which builds from `release`.
- **It does not solve the pause; it outlasts it.** The daily call keeps the project warm as a side
  effect, which is the workaround this section's previous paragraph names. It is named in `api/purge.js`
  too.

`src/test/gate.test.js`'s #98 AC 5 guard exempts exactly this one entry, and asserts that the
exemption is still needed and that it covers nothing else. Everything else stays client-triggered.

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
  benefit the tree suggests. *(Accepted for exactly one case on 2026-09-11, the #430 purge cron;
  see the amendment under "Scheduled functions" above.)* The Supabase auth context already exists at the Edge Function, the
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

## Measured 2026-09-07 — the extraction endpoint's own round trip, from a phone

- Measured by: **#209**, on the owner's phone (Samsung SM-S918U, Android 16 — `curl` 8.15.0-DEV in
  `adb shell` over USB, so nothing is attributable to a browser or a service worker)
- Function: **`extract-description`**, deployment **v2**, `ezbr_sha256`
  **`46499420bb93ab3e9988b20485db12a9e648eaaaa3600a496bc2cf86aa57787a`**, deployed
  2026-09-08T01:47:25.642Z by this story
- Samples: **252**, of which **84 are real extraction calls** — three passes of 28 cycles, each
  cycle three calls seconds apart
- Raw data: **`docs/extraction-latency-2026-09-07.tsv`**, all 252 rows, so every figure below can be
  recomputed rather than taken on trust
- **On the date, because the raw rows appear to disagree with it**: this section is dated by the
  LOCAL date, which is how every entry in this repo is dated — #208 records `0036` as applied
  2026-09-07 for a commit whose UTC instant is `2026-09-08T01:34Z`. The run began at 21:58 local, so
  every `ts_utc` in the dataset and every deployment timestamp quoted here reads `2026-09-08`. Same
  evening; not an error to correct

**This is the half #205 could not measure.** That story timed the deployed path with
`provision-member`, which refuses at its first authorization check — so it measured the toll and
explicitly not the endpoint's own work or the provider call. The three levels here close that gap
inside one cycle, on one network, seconds apart:

| level | what is sent | how far it gets |
|---|---|---|
| 1 | no `Authorization` header | the gateway. Nothing boots. |
| 2 | publishable key only | the function's own first authorization check. No provider call. |
| 3 | real session, own household | the whole thing, provider included. |

So **3 minus 2 is the endpoint plus the provider as a per-sample subtraction**, and 2 minus 1 is the
boot. Levels are classified from the body that came back rather than from which call was meant to be
sent: **0 of 252 came back mislabelled**.

### The figures

| pass | network | n | p50 | p90 | p95 | min | max | against 3000 ms |
|---|---|---|---|---|---|---|---|---|
| 1 | wifi, **degraded link** | 28 | 1,656 ms | 3,836 ms | **5,059 ms** | 1,267 ms | 16,787 ms | **169% — over** |
| 2 | cellular | 28 | 1,434 ms | 1,691 ms | **1,692 ms** | 1,211 ms | 1,721 ms | 56% — under |
| 3 | wifi, settled | 28 | 1,315 ms | 1,759 ms | **1,762 ms** | 1,114 ms | 2,757 ms | 59% — under |
| — | **all three pooled** | **84** | **1,456 ms** | 1,972 ms | **2,659 ms** | 1,114 ms | 16,787 ms | **89% — under** |
| — | the two clean passes | 56 | 1,419 ms | 1,692 ms | 1,759 ms | 1,114 ms | 2,757 ms | 59% — under |

The endpoint's own work plus the provider, as the per-sample subtraction:

| network | n pairs | p50 | p95 | min | max |
|---|---|---|---|---|---|
| cellular | 28 | 1,047 ms | 1,281 ms | 798 ms | 1,310 ms |
| wifi, settled | 28 | 922 ms | 1,411 ms | 319 ms | 1,465 ms |
| wifi, degraded | 28 | 994 ms | 4,363 ms | **−1,020 ms** | 16,308 ms |

**Read the degraded row's minimum before its p95.** A subtraction that comes out *negative* is the
tell that both legs are noise-dominated and neither number in that row means what it says — the same
shape #205 hit at n=8, where one outlier became "the p95 of transport" and made a difference
negative. It is kept rather than dropped because the pass really happened.

### Which pass to believe, and why the first one is not the endpoint's fault

**The level-1 control settles it, and it is the reason the control exists.** It cannot contain a
single millisecond of the endpoint or the provider, because nothing boots:

| pass | level-1 control, p95 | level-3, p95 |
|---|---|---|
| wifi, degraded | **3,698 ms** (max 7,026) | 5,059 ms |
| cellular | 571 ms (max 572) | 1,692 ms |
| wifi, settled | 1,403 ms (max 2,085) | 1,762 ms |

The first pass's *transport alone* was 2.6–6.5× the other two, and 4.5× #205's own wifi gateway p95
of 822 ms. So the 5,059 ms is this household's wifi having a bad five minutes, and re-running the
same probe on the same network after it settled read 1,762 ms. This is
cairn's `a-control-fired-seconds-before-separates-the-thing-from-the-moment`, working as intended:
without the per-cycle control the first pass would have been banked as "the extraction endpoint
misses its budget".

### The one finding that is NOT the network

**Cycle 12 of the first pass read 16,787 ms with clean controls** — its gateway call took 315 ms, its
boot-only call 479 ms, and DNS was 9 ms. Nothing about that cycle's network was unusual. The 16.3 s
sits entirely in the endpoint-plus-provider leg, so it is a provider tail event, and it is the single
worst sample in the dataset by a factor of six.

- **3 of 84** real calls exceeded the 3,000 ms budget.
- **1 of 84** exceeded `CLIENT_WAIT_MS` (6,000 ms — `DEPLOYED_LATENCY_BUDGET_MS × 2` in
  `src/lib/extractionThresholds.js`), which is what a phone actually waits before giving up. That
  member would have seen the typed-field fallback.

So the budget is met on the aggregate and the **tail is unbounded**, which no percentile at n=84 can
characterise. That is a finding for the epic rather than a defect in this story: the fallback exists,
it is what the one over-wait call would have reached, and #214 is where it is proved in production.

### Against the estimate the verdict was taken on

#207 could not measure this leg, so it took the verdict on the sum of two p95s and printed `(est.)`
everywhere the number appeared — **2,626 ms** on wifi, **2,245 ms** on cellular, both flagged as
overstating, since the sum of two p95s exceeds the p95 of the sum under independence.

| | estimated (#207) | measured (#209) | |
|---|---|---|---|
| deployed p95, wifi | 2,626 ms `(est.)` | **1,762 ms** settled / 5,059 ms degraded | |
| deployed p95, cellular | 2,245 ms `(est.)` | **1,692 ms** | |
| deployed p95, pooled | — | **2,659 ms** | |

**The estimate held.** On the pooled reading it held to **33 ms** — 2,659 measured against 2,626
estimated — which is closer than the method deserved and should be read as luck rather than as
precision. On the two clean passes the measurement is **33% below** the estimate, in the direction
#207 predicted: the sum of two p95s overstates. Either way the kill number is met and the axis stops
being an estimate.

### What this does not measure

**Cold start.** Every sample here is warm; #205's six 930 s idle windows are what characterise the
boot, and it read **180–260 ms**, small next to a 1.4 s round trip. The 2 minus 1 subtraction in this
run is too noisy to add anything — p50 came out at **−8 ms** on the degraded pass and 22 and 157 ms on
the other two, against #205's much better-controlled 98–145 ms. Take the boot figure from #205, not
from here.

**One sentence, one kind.** Every level-3 call sent the same `capacity` sentence, so this is the
latency of one input rather than of the corpus. A longer description means more output tokens and a
slower provider call; `docs/extraction-verdict.md` carries what the corpus costs.

**One evening, one household, one carrier.** Same caveat as #205's, and the first pass is the
evidence for it — the wifi column moved by a factor of three within an hour on the same link.

**A device-state change was borrowed and returned.** `curl --interface rmnet_dataN` binds the socket
and then answers *"Network is unreachable"* from the adb shell UID on this build, so #205's claim that
both networks are reachable without touching the phone did **not** reproduce. The cellular pass was
taken with wifi switched off (`svc wifi disable`) and switched back on afterwards, with `wifi_on`
read back as `1` to prove the restore. Pin adb to the USB serial before doing this: the phone also
advertises itself over wireless debugging, that transport is the one that dies with the radio, and a
bare `adb` refuses with *"more than one device/emulator"* while both are listed.

## Realtime on the Free plan — #342, 2026-09-08

#342 opens **one Supabase Realtime channel per phone**, subscribed to `postgres_changes` on the
eleven tables the client reads (`WATCHED_TABLE_NAMES` in `src/lib/realtime.js`), so a change one
phone makes reaches the others without a reload. Realtime is metered separately from the database,
and these are the numbers a household of **≤10 phones** is designed against — read off
`supabase.com/docs/guides/realtime/quotas` and `…/manage-your-usage/realtime-messages` on
2026-09-08, not from memory.

| Realtime quota | Free | Pro |
|---|---|---|
| Peak concurrent connections | **200** | 500 |
| Messages per month | **2,000,000** | 5,000,000 |
| Messages per second | 100 | 500 |
| Channel joins per second | 100 | 500 |
| Postgres Changes payload | 1,024 KB | 1,024 KB |

**What a message is.** "Each database change counts as one message per client that listens to the
event." Heartbeats and joins are not listed as counted; the page does not say so in as many words,
and that is stated here as the one soft number rather than assumed away.

**Connections.** One websocket per open app, joined or not-yet-joined alike (the channel opens on
join and closes on sign-out). Ten phones is 10 of 200. The household this app is built for could
run **twenty** such households before the connection ceiling, and a PWA left open on a counter
counts as one all day.

**Messages, the arithmetic.** A change is delivered once per *listening* phone, after the server has
run each table's RLS for that subscriber — so the count is (events per write) × (phones listening).
The writes here are small: a Done press is one `chores` UPDATE; adding a chore one INSERT; the
biggest single write is a re-balance, which is one `chores` UPDATE **per chore it moves**
(`apply_assignments`, `0018`). Taking a deliberately heavy week — **100 writes a day**, averaging
**3 events each** (a re-balance moving a dozen chores now and then, most writes one row), heard by
**10 phones** — is 100 × 3 × 10 = **3,000 messages a day, ~90,000 a month**, against 2,000,000:
**4.5 %** of the Free quota, which is ~22 such households. Doubling every assumption at once (200
writes, 6 events, 20 phones) is 720,000 a month, still under the ceiling with room; the number that
breaks it is phones, since the count is linear in listeners and a household does not have more than
ten of them.

**The unfiltered DELETE bindings do not change the arithmetic in kind.** A delete is broadcast to
every authenticated subscriber of that table (the platform applies no RLS to a delete and a
default-identity old record carries only the primary key — `0037`'s header and
`docs/access-model.md` carry why), so on a project holding several households a delete in one is a
message to the phones of all of them. Deletes here are rare (a removed chore, a cleared override, a
removed member) and a message is one id; at the two-or-three-household scale this project runs, it
is noise on the figure above rather than a term in it.

**Kill condition, so the arithmetic can be found wrong rather than believed.** The dashboard's
Realtime usage page (Project → Settings → Usage → Realtime) is the instrument; nothing in the repo
can read it. If **monthly messages exceed 400,000** (20 % of the quota, four times the heavy-week
estimate) for the household this app serves, or **peak connections exceed 30** with fewer than ten
phones, the estimate above is wrong in a way the design has to answer: the first remedy is
narrowing what is watched (a table that changes often and matters little, `calendar_busy`'s hourly
rows for instance, leaves `WATCHED_TABLES` by joining `UNWATCHED_TABLES` with a reason); the second
is Broadcast, which the platform recommends past ~3,000 subscribers on one change and which this
household is nowhere near. Nothing here needs the Pro plan, and nothing here is pg_cron: the
subscription is a client holding a socket open, and a paused project simply has no listeners.

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
