# Who can see household data outside production

**Decided 2026-08-20, story #19.** This is the record #5's Notes section defers to. It covers the
environments *around* production — preview deployments, test fixtures, seed data, screenshots.
It does **not** cover the database's own access rules; those are `docs/access-model.md` and #5's
AC 6.

The question has two faces and they are only dangerous **together**: a publicly reachable preview
URL, and a fixture carrying a real household member's name. Either alone is harmless, which is
exactly why neither is caught by a check aimed at one of them.

---

## Decision 1 — preview deployments are gated, behind a custom domain

**Vercel Authentication moved from *off entirely* to *Standard Protection*, and a custom domain was
added so production is reachable on a name of our own. Previews are login-gated; the household's URLs
are not.**

> **Applied 2026-08-21 by #121.** `taskr.madcowhq.com` was registered, attached, and verified serving
> production *before* protection was turned on. That ordering is recorded in
> `docs/deploy-runbook.md` step 6, which now describes the arrangement instead of the intention it
> used to. The table below was **re-measured after the change**, not edited.

### What is actually true, measured 2026-08-21

| | measured |
|---|---|
| Preview `taskr-ny8k2wptu-mad-cow1.vercel.app` | `302` to `vercel.com/sso-api`, landing on `vercel.com/login` |
| Its bundle, fetched anonymously | **unreachable** — the response is the login page and names no `assets/` path |
| `taskr.madcowhq.com` bundle | contains `https://oitdjvxtqdvegsrimexn.supabase.co` |
| `taskr-khaki.vercel.app` bundle | the **same** bundle, the **same** Supabase host |
| Repository | `PRIVATE` |

Read the first two rows against the ones they replace. Before the change that same preview answered
`200` with no redirect and served a bundle naming the **live** Supabase host, so a preview was a
second, world-readable front door onto the production database — different bundle, same backend.
That door is shut to anyone not logged into this Vercel account.

The bundle's filename is deliberately not cited. It is content-hashed, so it changes on every
build — this table named `assets/index-D45Q7VGT.js` for about two hours before the #124/#125
promotion made it `assets/index-D7p86CEG.js`. The claim is about what the bundle contains, and the
filename was never part of it.

The last two rows are unchanged, deliberately: **both production domains still ship the live Supabase
host, because that is what production is.** Gating previews did not narrow what a production URL
reaches and was never meant to.

### Why gating, and why now

**A shared, unguessable preview URL is deterrence, not defence.** That is the same distinction #5's
AC 7 demands be written down about the household join code, and it is not a coincidence: both are
secrets that travel, and neither becomes a permission by being hard to guess. Leaving previews open
was defensible while the shell held no data — that was the 2026-08-05 reasoning, recorded in #17 and
in `docs/deploy-runbook.md`, and it was explicitly scoped to *"the shell holds no data at the time"*.
That condition has expired.

What changed is not the URL, it is the second row of the table above. A preview is a **live front
door to the production database**, and it is the one nobody watches: production has an owner who
loads it, while a preview from a three-day-old branch sits up indefinitely with nobody looking. The
near-miss has already happened in this project — a `sb_secret_…` key was once set as
`VITE_SUPABASE_ANON_KEY` and shipped into a world-readable preview bundle, where it bypassed every
policy in `supabase/migrations/` and **nothing failed**, because nothing can. `vite.config.js` and
`src/lib/keyShape.js` exist because of it.

### What this does and does not buy — the part not to overstate

**It gates the client, not the data.** After #121 an unauthenticated stranger cannot load the preview
app at all, which removes an entire unwatched surface. It does **not** replace row-level security,
and it must never be read as having done so: anyone who does reach the production URL is still held
off by RLS plus a per-member credential, asserted over the wire by
`src/test/rls.integration.test.js`. This decision narrows *how many* doors exist; RLS is still the
lock on the one that stays open.

That distinction matters because the failure mode of a gate is complacency. A project that has just
turned protection on is exactly the one most likely to under-invest in the policies underneath it,
and the policies are what the data actually rests on — including which migrations are *applied to the
live project*, which is not a property of this repository at all. `docs/access-model.md` tracks that,
and it is the harder half.

### What it costs

- **$10.44/yr for the domain, plus DNS.** The only recurring cost. Two names were registered rather
  than one — `madcowsailing.com` alongside `madcowhq.com` — taking it to about $21/yr; that was an
  owner decision at the gate, recorded against #121's cost line rather than left to read as overrun.
- **No household outage — and this reverses what this document predicted.** The bullet that stood
  here said the assigned `taskr-khaki.vercel.app` production URL *"becomes login-gated too"*,
  reasoning from Vercel's own wording — *"protect all except production **Custom Domains** for your
  project"* — that the assigned `*.vercel.app` URL is protected **by design**. Measured 2026-08-21 on
  uncached paths, it is not: **both production domains reach the app, while every per-deployment URL
  is gated, the production deployment's own included.** So no installed PWA broke, no phone was
  forced to re-install, and the ordering hazard #121 leads with could not have fired. The prediction
  was derived from documentation and never measured, which is exactly why it survived eight days and
  drove a purchase.
- **The domain's justification is therefore weaker than the one argued here.** Protection could have
  been switched on with no custom domain at all and the household would have kept a working URL. What
  the domain actually buys is a published name of our own, independent of Vercel's generated one —
  worth having, and not what it was bought for.
- **Every artefact naming `taskr-khaki.vercel.app` as the URL to publish became wrong**, the README
  included. Corrected by #121 in the same change.

### What would reverse it, and what that costs

**Reversing is free and instant** — Deployment Protection back to *off*, one dashboard toggle, and
previews are public again. That asymmetry is worth naming: this decision is cheap to undo and the
thing it prevents is not, which is the right way round for a control over other people's data.

The alternative that was considered and **rejected** is worth recording, because it is stronger on
paper: **a separate Supabase project for the Preview environment**, which stops previews touching
real data by construction rather than by gating a URL. It is free. It was rejected because it costs
the one thing this repo is measurably worst at — **every migration pasted by hand twice**, when
`0007` already sat written, proven and unapplied for eight days. A staging project silently one
migration behind is a preview that lies, which trades a known failure mode for a quieter one.

A third option — unsetting the Preview environment variables so previews build but reach no database
— was raised and not taken. It is the cheapest of the three and it makes every preview useless for
exercising a data flow.

### Revisit when

- **Vercel changes what *Standard Protection* exempts.** This arrangement rests on a measured
  behaviour that contradicts Vercel's own documented wording: both production domains are exempt, not
  only the custom one. A vendor is entitled to make its documentation true. If that happens the
  assigned `taskr-khaki.vercel.app` becomes gated and any install still pointed at it breaks — so
  re-measure with the uncached probe in `docs/deploy-runbook.md` step 6, rather than re-reading the
  documentation that was wrong the first time.
- Household data stops being *this* household's — a second household, or anyone outside it, joins.
- A migration weakens or removes a policy, rather than adding one.
- Anything ever reaches the client that RLS does not gate.

---

## Decision 2 — no real household name, and no screenshot, enters version control

**The rule: every person and household named in test fixtures, seed data or committed assets comes
from the declared placeholder vocabulary. No screenshot of the running app is committed.**

The vocabulary lives in `src/test/gate.test.js` (`PLACEHOLDER_NAMES`), not here, because a list in
prose beside a list in code is two lists. It is a mixture of structured placeholders
(`Placeholder One`, `Other Organizer`, `Mutant Household`, `Intruder`, `Sibling`) and three generic
given names already in the tree — `Alex`, `Robin`, `Sam`.

**Those three were audited against the real household by the owner on 2026-08-20 and none of them
names anyone in it.** That sentence is the load-bearing part: no check can recognise a real name it
has not been shown, so the vocabulary being clean is an owner's observation, recorded, and not
something the guard establishes.

**Why the enforcement is a positive vocabulary rather than a denylist**, which is the obvious design
and is unavailable: a denylist of the household's real names would put those names in git, which is
the precise thing being prevented.

### What enforces it, and what it cannot see

Three assertions in `src/test/gate.test.js`, deliberately with **different blind spots** — none is
sufficient alone:

| assertion | catches | blind to |
|---|---|---|
| **Shape scan** — every capitalised-word-shaped literal in the fixture corpus must be declared | a name in *any* position, including syntax the check was never taught | a name written in lower case |
| **Position scan** — every person-name-shaped literal in a name *position* (`create_household` arg 2, `organizerName`, `displayName`, `name:`, `h.name =`) must be declared, case-insensitively | `name: 'alex'` | a position not on the list |
| **Asset scan** — no tracked image outside the manifest's icon set | a committed screenshot | an image outside the extension list |

The corpus is discovered from `git ls-files`, not hard-coded, so a new test file is scanned the day
it lands.

**None of the three can tell a real name from a plausible one.** They enforce that the vocabulary is
*declared*, which converts the failure from "somebody committed a real name" into "somebody added a
name to a list, in a diff, where it is visible" — that is the whole of what a check can do here, and
it is worth saying plainly rather than implying more.

### Scan at the time this story closed, 2026-08-20

- Tracked images: `public/favicon.svg`, `public/icons/icon-192.png`, `icon-512.png`,
  `icon-512-maskable.png`. **No screenshots.**
- Every name literal in `src/**/*.test.js(x)`, `src/test/**`, `src/lib/allocation.corpus.js` and
  `supabase/migrations/*.sql` is in the declared vocabulary. **No real household name anywhere in
  the tree.**
- The legacy `Dad`/`Bro`/`Sis`/`Mom` icons never entered this rebuild — `scripts/generate-icons.mjs`
  regenerates the icon set from nothing, and `docs/license-scope.md` records why.

---

## Decision 3 — the cohssa-attendance minor-data policy is **ADAPTED**

Not adopted, and not ignored. `cairn/policies/cohssa-minor-data-handling.md` explicitly declines to
generalise to other projects, so inheriting it silently was not available; claiming all five of its
controls apply here would have been worse, because three of them have no referent in Taskr and a
rule that cannot fail reads as coverage.

**Carried, on their merits:**

| cohssa control | how it applies here |
|---|---|
| 4 — real names never enter git | **Decision 2 above.** Same rule, different enforcement: cohssa keeps a placeholder roster and loads the real one at runtime; Taskr has no roster file at all, so the vocabulary guard is the equivalent. |
| 5 — the repo stays private | **Still true, measured 2026-08-20.** It is now a control rather than an accident, and this record is where that is written down. |

**Deliberately not carried**, each because its hazard does not exist here:

| cohssa control | why not |
|---|---|
| 1 — sensitive columns in a separate Drive file | The hazard is Sheets having *no column-level permission*, so a scope grants the whole file. Postgres does have column grants, and Taskr uses them (`0002`, `0005`); the equivalent control is already in the migrations. |
| 2 — the sensitive file's sharing is tighter than the coach group | There is no second file, and no group. |
| 3 — OAuth scope limited to `spreadsheets` on one file | There is no OAuth read of a third-party document. **This will need re-reading when the Google Calendar work (#95–#102) lands**, which does add one — and the charter has already ratified that only *derived busy minutes* are stored, never titles, attendees or times. |

**The data classes are not the same, and the record should say so rather than borrow the alarm.**
cohssa's policy exists because an enrollment export carries medications, mental-health diagnoses,
insurance numbers and home addresses for roughly 31 minors. Taskr holds names, weekly available
minutes, chores and completion behaviour. That is meaningfully less exposing — and it is still a
list of children with a routine, sitting in a third-party database behind a world-readable URL,
which is why it gets controls at all rather than a shrug.

---

## What this record does not decide

- **Row-level security.** #5's AC 6, `docs/access-model.md`. One criterion with two owners is one
  criterion nobody owns.
- **Which migrations are live.** `docs/access-model.md` tracks that, and it is a fact about the
  Supabase project rather than about this repository.
- **Google Calendar content.** The charter's amendment (PR #94) settles that only derived busy
  minutes are stored. When #95 lands, cohssa control 3 becomes relevant here for the first time and
  this section is the place to reopen it.
