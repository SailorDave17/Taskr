# Who can see household data outside production

**Decided 2026-08-20, story #19.** This is the record #5's Notes section defers to. It covers the
environments *around* production — preview deployments, test fixtures, seed data, screenshots.
It does **not** cover the database's own access rules; those are `docs/access-model.md` and #5's
AC 6.

The question has two faces and they are only dangerous **together**: a publicly reachable preview
URL, and a fixture carrying a real household member's name. Either alone is harmless, which is
exactly why neither is caught by a check aimed at one of them.

> **Re-read 2026-09-04, story #158.** Both of this record's fired triggers are answered where they
> were raised: Decision 1's second-household trigger under *Re-read 2026-09-04* below, and Decision
> 3's control 3 and control 5 under theirs. A third section states what an **invitation** may expose
> to somebody who has not joined yet, which #171, #172, #173 and #177 consume rather than re-decide.
>
> Two things moved that no trigger here predicted, and both are recorded below rather than quietly
> fixed: **the repository is public**, so control 5 is superseded — and the *tracker* went public
> with it, which is a surface Decision 2's guard cannot see by construction.
>
> **What this re-read deliberately did not change is listed at the end**, so a considered *stands*
> can be told from an unexamined one.

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

Rows 3 and 4 are unchanged, deliberately: **both production domains still ship the live Supabase
host, because that is what production is.** Gating previews did not narrow what a production URL
reaches and was never meant to. *(This sentence said "the last two rows" until 2026-09-04 and meant
these two; the `Repository` row below them was never one of the pair.)*

**The `Repository` row is the one that has since moved, and it is the only row in this table that
has.** It reads `PRIVATE` because that was true when it was measured; the repository is **public**
now. The row is left as written because the table is a dated measurement rather than a status
display — the current reading, and what it cost, is in *Re-read 2026-09-04 — control 5 is
superseded* under Decision 3.

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

### Re-read 2026-09-04 — the second-household trigger fired (#158)

The trigger, verbatim as it stood: *"Household data stops being **this** household's — a second
household, or anyone outside it, joins."*

**It fired on 2026-08-31.** #241 created the first second household the live project has ever held —
`create_household` called through the app by its own organizer, on a real confirmed account, with the
member row claimed and the timezone set in the same statement. It is a permanent resident, not a
fixture: it sits in the same tables, behind the same URLs, under the same policies as the owner's own
household, and there is no environment boundary between them.

**Verdict: Decision 1 STANDS, unamended in substance.** No control changes and no cost line is
withdrawn. What the re-read adds is an unstated premise made explicit and given an expiry — see
*What the trigger changed* below, which is also where this re-read corrects the reading a fired
trigger invites.

#### Every measurable row still holds — re-measured 2026-09-04, anonymously

| | measured 2026-09-04 |
|---|---|
| Preview `taskr-ny8k2wptu-mad-cow1.vercel.app` | `302` to `vercel.com/sso-api` — **unchanged** |
| `taskr.madcowhq.com` | `200`, and its bundle still names `…supabase.co` — **unchanged** |
| `taskr-khaki.vercel.app` | `200` — **unchanged**, so Standard Protection still exempts both production domains and not the per-deployment URLs |

The bundle filename is again not cited, for the reason the 2026-08-21 table gives: it is
content-hashed and had already moved twice by this reading. The claim is what the bundle *contains*.

#### What the trigger changed, and the larger thing it did not — read this before citing the trigger as fired

**The trigger fired on its letter and not yet on its substance, and the difference is the whole
finding.** The second household is a permanent resident of the live project and it is **organised by
the owner**, under a plus-alias on their own inbox, with a placeholder-style name carrying its issue
number. #241 created it so that household scoping had something to be observed against, which had
never been possible with one household in existence.

So the sentence a reader reaches for — *somebody else's data is now behind this gate* — is **false
today**. Every row on the live project still belongs to the person who wrote this document. That is
worth stating plainly rather than letting the trigger's firing imply otherwise, because the
overstatement is the attractive one: it makes the control look better justified than it is, and this
record has already been wrong once by reasoning from what a thing sounded like rather than measuring
it.

**What did change is that the gate now protects a boundary rather than a single subject.** Before
2026-08-31 "the household's data" and "everything on the project" named the same set, so no control
here could tell the difference between protecting a family and protecting a database. They are now
distinguishable, and every claim in this record that quietly relied on their being the same thing is
now a claim that has to pick one. This re-read found no such claim that picks wrongly — Decision 1
gates an environment, which is the right half — but the distinction did not exist when it was
written, so it was not a considered choice until now.

**The consequence, stated as an expiry rather than as a change.** The cost line *"reversing is free
and instant"* is true and stays true. It rests on an unstated premise that is still holding: every
row behind the gate belongs to the person who would flip the toggle. **On the day a household is
organised by somebody who is not the owner, that line stops being a cost note and becomes a decision
somebody else has a stake in** — mechanically still one toggle, no longer unilaterally the owner's.
That day is the first replacement trigger below, and it is deliberately phrased as *an organizer who
is not the owner* rather than *a second household*, which is the mistake this record just avoided
making twice.

#### The half of the trigger that has NOT fired, stated so it is not read as discharged

The trigger names two events and only one has happened. **A second household exists; nobody belongs
to two.** The schema has permitted plural membership since `0007` — `current_household_ids()` returns
`setof uuid`, and its comment says so — but no mechanism creates that state: #167, #168, #171, #172,
#173 and #177 are all open, and #191 has since superseded the organizer-initiated direct-add surface
#168 and #169 were filed for. So the trigger fired on the **data** side and not the **membership**
side, and the invitation rule below is therefore written *before* the mechanism rather than after it,
which is the only reason it can bind #171 rather than describe it.

*(**The lead clause above is still true of live data and its justification is not, as of
2026-09-09.** #166 merged a mechanism that creates the state — the *Start another household* card on
the Who tab — and it is on none of the issue numbers listed here. Nobody belongs to two households
yet, because merging a mechanism creates no membership row; the state fires the first time somebody
taps that control, which is one tap after a deploy. Annotated in place rather than rewritten, this
file's own idiom: what was believed when the re-read was taken stays visible. The re-read this owes
is **#401**.)*

*(**Two more corrections to the same sentence, 2026-09-09, annotated in place for the same reason.**
First, **#341 shipped a mechanism that reaches the membership side for one case**: re-inviting an
address whose auth user is still PENDING returns that same user and claims it onto a member row in a
second household — measured in `src/test/provisioning.functions.test.js`, *re-inviting a PENDING
address returns the same account rather than a second one*. So the list of open issues above is no
longer the whole answer to *what could create this state*; an ESTABLISHED account is still refused,
which is the half that remains. Second, **#169 was not superseded — only #168 was.** #169's own
routing comment of the same date says #341 cannot replace it, because #341 refuses precisely its
subject. #168 is closed as not planned; #169 stands, behind `#171 → #172 → #173`.)*

### Revisit when

- **Vercel changes what *Standard Protection* exempts.** This arrangement rests on a measured
  behaviour that contradicts Vercel's own documented wording: both production domains are exempt, not
  only the custom one. A vendor is entitled to make its documentation true. If that happens the
  assigned `taskr-khaki.vercel.app` becomes gated and any install still pointed at it breaks — so
  re-measure with the uncached probe in `docs/deploy-runbook.md` step 6, rather than re-reading the
  documentation that was wrong the first time.
- ~~Household data stops being *this* household's — a second household, or anyone outside it,
  joins.~~ **Discharged 2026-09-04 by the re-read above** — fired 2026-08-31 (#241), answered
  *stands*. Replaced by the next three bullets, which are what the reasoning is actually sensitive
  to and which the original bullet conflated into one event. A discharged trigger left in place reads
  as live, so it is struck rather than deleted: what was watched for stays visible.
- **A household is organised by somebody who is not the owner.** This is the substance the struck
  bullet was reaching for, and #241 shows why *a second household* was the wrong proxy for it: two
  households exist and both are the owner's. This is the day *"reversing is free and instant"* stops
  being a cost note, and it is the one to watch.
- **The membership half fires — one person belongs to two households at once.** That is the point at
  which a single signed-in session can hold two households' data in one client at one time, and the
  questions this decision answers about *environments* start needing an answer about *sessions*.
  **Still unfired, and the thing that will fire it changed on 2026-09-09**: this read "which #173's
  redemption is the first thing that can produce" until #166 shipped the *Start another household*
  card, which needs no invitation and no second person — the organizer taps it themselves. A reader
  watching #173 for this was watching the wrong story. The re-read is filed as **#401**, blocked on
  #164/#165/#166 merging, because the state is not reachable until they do.
- **Anyone needs to see a preview who does not hold a login on this Vercel account.** Gating is the
  whole mechanism; the first legitimate viewer it locks out is when a different mechanism — a
  separate Supabase project for Preview, rejected above and for reasons that would need re-pricing —
  becomes the cheaper answer rather than the more expensive one.
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

Four assertions in `src/test/gate.test.js`, deliberately with **different blind spots** — none is
sufficient alone:

| assertion | catches | blind to |
|---|---|---|
| **Shape scan** — every capitalised-word-shaped literal in the corpus must be declared | a name in *any* position, including syntax the check was never taught | a name written in lower case; anything not in straight quotes |
| **Position scan** — every person-name-shaped literal in a name *position* (`create_household` arg 2, `organizerName`, `displayName`, `name:`, `h.name =`) must be declared, case-insensitively | `name: 'alex'` | a position not on the list |
| **Prose scan** — no UUID- or address-shaped string in `README.md` or `docs/*.md` (#409, reusing #328's `classify`) | a live row id or a member address written into a document, quoted or not | a real *name* in a sentence, which has no shape |
| **Asset scan** — no tracked image outside the manifest's icon set | a committed screenshot | an image outside the extension list |

The corpus is discovered from `git ls-files` plus untracked-not-ignored files, not hard-coded, so a
new file is scanned the day it lands. It is **two corpora**: the fixture corpus
(`src/**/*.test.jsx?`, `src/test/**`, `src/lib/*.corpus.js`, `supabase/{migrations,seed}/*.sql`),
and — since #409 — the prose corpus (`README.md`, `docs/*.md`), which the first two assertions also
read. Why the prose corpus needs a rule of its own, and what the pair still cannot reach, is in *The
gap found by walking into it* below.

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
| 3 — OAuth scope limited to `spreadsheets` on one file | **Added here 2026-09-04**, moved up from the table below now that #95 has given it a referent. Met by `calendar.freebusy` alone. Full verdict, and the credential class no cohssa control reaches, in *Re-read 2026-09-04 — control 3* below. |
| 4 — real names never enter git | **Decision 2 above.** Same rule, different enforcement: cohssa keeps a placeholder roster and loads the real one at runtime; Taskr has no roster file at all, so the vocabulary guard is the equivalent. |
| 5 — the repo stays private | ~~**Still true, measured 2026-08-20.** It is now a control rather than an accident, and this record is where that is written down.~~ **SUPERSEDED 2026-09-04 — the repository is public.** See *Re-read 2026-09-04 — control 5 is superseded* below. Struck rather than deleted: this row is the reason a reader would believe the repo is private. |

**Deliberately not carried**, each because its hazard does not exist here:

| cohssa control | why not |
|---|---|
| 1 — sensitive columns in a separate Drive file | The hazard is Sheets having *no column-level permission*, so a scope grants the whole file. Postgres does have column grants, and Taskr uses them (`0002`, `0005`); the equivalent control is already in the migrations. |
| 2 — the sensitive file's sharing is tighter than the coach group | There is no second file, and no group. |
| 3 — OAuth scope limited to `spreadsheets` on one file | ~~There is no OAuth read of a third-party document. **This will need re-reading when the Google Calendar work (#95–#102) lands**, which does add one — and the charter has already ratified that only *derived busy minutes* are stored, never titles, attendees or times.~~ **MOVED 2026-09-04 to *carried* — #95 landed and this control now has a referent.** See *Re-read 2026-09-04 — control 3* below, which also corrects the attribution in the struck sentence: the minimization decision is real and the charter is not where it was taken. |

**The data classes are not the same, and the record should say so rather than borrow the alarm.**
cohssa's policy exists because an enrollment export carries medications, mental-health diagnoses,
insurance numbers and home addresses for roughly 31 minors. Taskr holds names, weekly available
minutes, chores and completion behaviour. That is meaningfully less exposing — and it is still a
list of children with a routine, sitting in a third-party database behind a world-readable URL,
which is why it gets controls at all rather than a shrug.

### Re-read 2026-09-04 — control 3, now that the calendar has landed (#158)

The obligation, verbatim: control 3 *"will need re-reading when the Google Calendar work (#95–#102)
lands"*. **#95 closed 2026-08-24** and shipped `supabase/functions/calendar-connect`, migration
`0011` and `src/lib/calendar.js`. Taskr has an OAuth read against a third party for the first time,
so control 3 has a referent and stops being hypothetical.

**Verdict: control 3 moves from *deliberately not carried* to *carried*, and it is met — narrowly,
and by construction rather than by discipline.**

| what cohssa's control 3 asks | what shipped |
|---|---|
| the narrowest scope that answers the question | `calendar.freebusy` and nothing else (`GOOGLE_FREEBUSY_SCOPE`, `src/lib/calendar.js`). It returns intervals: no titles, no attendees, no locations. `calendar.readonly` answers the same capacity question and reads the events too, and was not asked for |
| the scope is the one that was *requested* | stronger here — `0011` stores what Google **granted**, from the token response rather than from the request, because a later slice has to know which scope it is holding and the request is not evidence of that |

**And one thing cohssa's control 3 does not contemplate at all, which is worth more than the
verdict.** cohssa's OAuth read holds a scope; Taskr's holds a **credential**. `calendar_tokens` stores
a Google refresh token — long-lived, not self-expiring, a bearer credential belonging to a person,
sitting in the household database. That is a class of data neither this record nor the policy it
adapts had ever weighed, and no control numbered 1–5 reaches it.

`0011` handles it well and argues for itself at length: no client grant of any kind, no policy for
`authenticated`, RLS enabled with no policy at all so a future accidental grant still reaches no row,
and the readable half split into a separate `calendar_connections` table. The point of writing it
down here is that **the reasoning lives in a migration comment**, which is not where anybody looks
for a data-handling control. So it is stated as one:

> **Control 6, Taskr's own, with no cohssa analogue.** A credential belonging to a third party is
> held in a table with **no client grant and no policy**, written and read only by an Edge Function
> as `service_role`, never as a column of a table any client can name. The readable status — that a
> person is connected, and to what scope — is a *different table*, so the client's grant and the
> credential's absence of one cannot be edited in the same line.
>
> Revisit when: any client-role grant is proposed on `calendar_tokens`; a second provider is added;
> or a credential of this class is stored anywhere but through this shape.

#### A correction this re-read found, in this record's own words

Two sentences here — the struck control 3 row above, and the *Google Calendar content* bullet at the
end — said the charter *"has already ratified that only derived busy minutes are stored"* and that
*"the charter's amendment (PR #94) settles"* it. **PR #94 does something close to the opposite.** It lists data
minimization as one of three questions it explicitly hands onward: *"store the derived busy-minutes
or the events themselves"*, under a heading reading *"New open questions this creates (owed at
grooming, not settled here)"* — and `docs/refresh-charter.md` still carries it there today.

**The decision is real; the citation was wrong.** It was taken at the groom gate on 2026-08-16 and
recorded in **#96's body**, not in the charter: *"Data minimization: derived busy-minutes only … no
titles, attendees, or event times, ever"*, with raw-event caching rejected in band as the biggest
privacy surface the app would hold. #96's AC 3 makes it testable — the derived table may hold
`member_id, period_start, busy_minutes, event_count, computed_at` and nothing else.

So this record cited a document that **visibly disagrees with the claim it was cited for**, and the
disagreement survived because nobody re-opened the charter. That is the ordinary failure of a derived
copy: the derivation kept the claim and dropped the hedge, and a hedge is the one thing a copy can
lose for free.

**One consequence of the correction, which the original wording would have hidden.** #101 widens the
scope to `calendar.readonly` by incremental consent, because event import genuinely cannot work
without titles. Read against a charter that had "already ratified" minimization, that reads as a
reversal. Read against what was actually decided it is not: the ratified rule is about what is
**stored**, and #101's own first criterion holds the line where it was drawn — titles transit the
server per request and are never written. The scope widening is a stated consequence of the
minimization decision rather than a reopening of it, and control 3's verdict above is scoped to the
freebusy world it was measured in.

**Revisit control 3 when** #101 is picked up — the widened scope makes control 3's "narrowest scope"
reading false on its face, and what will then need re-reading is whether *transits but is not stored*
is a claim this record is willing to make on a person's behalf, which is a different question from
the one answered here.

#### Re-read 2026-09-08 — control 3, at #101's pickup

The trigger fired. #101 asks a connected member for `calendar.readonly` by incremental consent the
first time they open *Import from calendar*, and the "narrowest scope that answers the question" row
above is now false as written: the question changed. Free/busy answers *how busy is this week*;
import asks *what is this event called*, and there is no narrower scope that answers it. So the row
is re-read against the NEW question, and the verdict is the same shape as before — **met, narrowly,
by construction**:

| what control 3 asks | what #101 ships |
|---|---|
| the narrowest scope that answers the question | `calendar.readonly` (`GOOGLE_CALENDAR_READONLY_SCOPE`, `src/lib/calendar.js`). It answers *what is on my calendar* and cannot write. It is asked for **only when a member opens import**, and only then — a member who never imports never grants it, which is what makes the widening incremental rather than a wider initial ask |
| the scope is the one that was *requested* | unchanged: `0011` stores what Google **granted**, and `hasEventReadScope` reads the widened grant off that row rather than remembering that it was asked for |
| *transits but is not stored* — the claim the revisit note said would need re-reading | **Made, and made structural.** The `calendar-events` Edge Function reads the week's events and returns id, title, start, end and a local date to the phone, asking Google for exactly those fields (`fields=items(id,summary,start,end,status)`) and copying from a fixed set as a second wall; its test plants attendees, a location and a description in Google's payload and asserts none survives in the response, and records every write the fake client is offered and asserts none. The one datum that IS stored is the **event id**, in `calendar_imports` (`0038`), a table with no column for anything else, kept so a second import is refused. So the claim this record makes on a person's behalf is narrower than *transits but is not stored*: **a title transits; an id is stored; nothing else is either** |

What this re-read does NOT settle, and hands to #102: whether the real incremental consent screen
grants what `EVENT_READ_SCOPES` expects, and whether the second consent moment costs the friction the
charter's kill condition prices. Both are observations only a real account can make.

**Revisit control 3 when** a third scope is proposed, or when anything proposes STORING a field the
`calendar-events` response carries — a title cached "for the list", a start time kept "for the
chore's due date" — because the line this re-read holds is exactly there.

### Re-read 2026-09-04 — control 5 is superseded (#158)

Recorded above as *"Still true, measured 2026-08-20"*, and as *"a control rather than an accident"*.
**It has been false since some point before 2026-08-30**, and nothing in this document noticed.
*Measured 2026-09-04*: `gh repo view SailorDave17/Taskr --json visibility` answers **`PUBLIC`**.

**Verdict: superseded, deliberately, by a decision taken in a different document** — and confirmed as
superseded rather than repaired at this re-read's gate (owner, 2026-09-04).

`docs/ci-gate.md` carries the why, and it is a good reason: branch protection and the newer rulesets
API are both unreachable on a private repository on a free plan, so "add branch protection" was a
purchasing decision rather than a configuration task. The repository was made public, which made
rulesets reachable, and #289 spent that reachability to turn the CI gate from advisory into
enforcing. **The trade was a control resting on nobody looking, for a gate that refuses a push.**

Two things about it are worth recording rather than approving and moving on:

- **The trade was made without this record being consulted**, which is exactly the failure
  `cairn/policies/cohssa-minor-data-handling.md` predicts when it refuses to generalise to other
  projects. A control adopted from a policy that disclaims transfer has no owner in the receiving
  repo, so it is nobody's job to notice when it stops being true. It was noticed here only because a
  story asked for the document to be re-read against something else.
- **Re-privatising was considered and rejected at the gate**, not overlooked. It would restore the
  control literally and undo #289, returning the CI gate to advisory — a real control lost to
  reinstate a passive one.

**What carries control 5's weight now: nothing, and that is the honest answer.** Decision 2 is
untouched by this, because Decision 2 never rested on the repository being private. `gate.test.js`
says so in a comment written before the repository went public — a name in version control *"is
exposed to everyone with repository access, to every future reader, and to whatever the hosting
arrangement happens to be on the day; gating one URL changes none of those."* That sentence was
written about #121 and it is the right answer to this too. The vocabulary guard does the same work
against the same threat at the same strength; what has gone is the second line that made a mistake
in the first one survivable.

So the operative change is not to any control. It is to **how much a Decision 2 miss costs**: before,
a real name reaching the fixture corpus was exposed to whoever holds repository access; now it is
published. The guard was already the load-bearing control and is now the only one.

#### The surface control 5 was quietly covering, and ~~no guard reaches~~ **only a detective one reaches (#328)**

*The heading is struck rather than rewritten: it was true when it was written on 2026-09-04, and it is
the sentence a reader would have believed. Decision 5 below is what changed it.*

**The repository going public took the tracker with it, and the tracker is outside every check here.**
Decision 2's corpus is `git ls-files` plus untracked-not-ignored files — issues, comments and pull
request bodies are not files, so no scan in `gate.test.js` has ever been able to see them, and none
was ever meant to. *(Still true of `gate.test.js`, and no longer true of the repository: #328 added
`scripts/scan-tracker.mjs` and a workflow that reads the tracker directly. It is detective rather
than preventive, which is why the paragraph above is amended rather than deleted — the claim that
nothing can **refuse** a live identifier before it is published survives intact.)*

*Measured 2026-09-04*: **four issues name the real household**, and one of them additionally carries
the owner's address, both live household ids and an organizer's auth and member ids — recorded there
deliberately and correctly under a criterion that asked for exactly that, at a time when the tracker
was private. Nothing in that record was a mistake when it was written. It became world-readable
because a different document made a different decision.

The values are deliberately not repeated here — writing them into `docs/` would move them from a
surface no guard watches into the one surface Decision 2 does, which is the wrong direction.

**Settled 2026-09-10 by #328 — see Decision 5 below.** The verdict in one line: the identifiers
were **redacted in place across all four classes, with nothing deleted**, and the shape half of the
search now runs as a workflow. What this paragraph described as an unwatched surface is watched
after the fact and cannot be watched before it, for a reason that is GitHub’s rather than this
repository’s.

---

## Decision 4 — what an invitation may show somebody who has not joined yet

**Decided 2026-09-04, story #158**, before the mechanism exists rather than after it. #171 and #173
both name this re-read as where their no-disclosure rule comes from, so this section is written to be
**consumed as clauses**, not paraphrased.

The whole of admission is a stranger being handed something that reaches household data. Every other
decision in this record is about surfaces the household does not choose — a preview URL, a fixture, a
repository. An invitation is the first one the household *aims at a person on purpose*, and it is
therefore the first place where saying too little is also a failure: a recipient who cannot tell what
they are joining cannot give a meaningful yes.

### The rule

1. **An emailed invitation MAY name the household** (#177, #191). It is addressed to an address the
   organizer typed, so the household chose the recipient. It may carry the household's name and the
   inviter's display name, and nothing further.
2. **A typed code MUST NOT name the household** before it is redeemed (#172, #173). A code travels —
   read aloud, forwarded, screenshotted — so whoever ends up holding it is not the person the
   organizer chose. Its redemption surface may name the **inviter's display name** and no more, which
   is enough for a recipient to recognise a legitimate invitation without publishing a family name to
   whoever finds the code.
3. **Neither may carry household *contents* at any point before redemption completes** — no roster,
   no other member's name or address, no chores, no completion history, no capacity figures, and not
   the household id.
4. **Every refusal discloses nothing at all**, which #173 AC 3 and #177 AC 5 already state and this
   clause ratifies: expired, withdrawn, already-redeemed and never-existed are refused without
   revealing the household's name, or that a household matching the code exists. The four cases may
   each say *why* they were refused; none may say *what* was refused.
5. **What a member sees on the way in is not what a non-member may see on the way to the door.**
   Clauses 1–4 bind until a member row exists. Afterwards the roster is visible to everyone in the
   household, which every other decision here already assumes.
6. **The distinction is the CHANNEL, never the screen.** #177's link opens the same redemption
   surface a typed code does, so a screen that reads its own disclosure level off *which component is
   rendering* will get clause 2 wrong for half its traffic — silently, and in the permissive
   direction. What may be named is a property of how the invitation reached the person: arrived by
   emailed link, clause 1; typed in, clause 2. A surface serving both derives it from the invitation,
   and a surface that cannot tell them apart falls back to clause 2.

### Why this split rather than one rule for both paths

The obvious alternatives were both available and both are worse for one clause each.

- **Never name the household on either path** is the strictest, and it makes clause 1 pay for clause
  2's problem. An emailed invitation that will not say what it invites you to is an email people are
  right to distrust, and #177 has to survive a recipient's spam filter and their judgement.
- **Always name it** is the best experience and hands whoever finds a stray code a real family name.
  This record spends an entire guard keeping exactly that string out of version control; publishing
  it through a redemption screen would be the same exposure by a shorter route.

The split follows this record's own line, argued for the join code in #5's AC 7 and restated under
Decision 1: **an unguessable secret is deterrence, not defence.** A code is a secret that travels and
an addressed email is not, so they earn different answers — and that is the whole reason clause 1 and
clause 2 differ.

### Revisit when

- **An invitation gains a second channel** — an SMS, a link posted into a group chat, a QR code. Each
  is a code-shaped path wearing an email's clothes, and clause 2 rather than clause 1 is the default
  for anything that travels.
- **A household name stops being a family name.** Clause 2's cost is entirely that household names
  here are real surnames; if naming ever becomes free-text people choose deliberately, clause 2 is
  worth re-pricing rather than kept out of habit.
- **Anything is added to a pre-redemption surface**, at all. Clause 3 is a closed list, and the way a
  closed list fails is one useful-looking addition at a time.

---

## Decision 5 — what the public tracker carries, and what it may carry

**Decided 2026-09-10, story #328.** The pointer under Decision 3’s control-5 re-read said the gap
was real and routed the decision here; this section is that decision. The re-read's *"four issues name the real
household"* was **exactly right and exactly incomplete** — the four are #102, #162, #241 and #242,
and the household name is one of four classes.

### What was there, measured rather than remembered

The set is produced by a **repeatable search**, `npm run scan:tracker`
([`scripts/scan-tracker.mjs`](../scripts/scan-tracker.mjs)), not by reading. It has two halves: a
shape half for UUID- and address-shaped strings that needs no secret, and a term half whose search
terms are the live project's own household names and member addresses, read from the database at run
time and never written down. *Measured 2026-09-10 over 211 issues and 197 pull requests*: **13 items,
15 places, 16 distinct values.**

| Class | Items |
|---|---|
| Live row ids — household, member and `auth.users` | #162, #241, #246, #247, #262, #279, #349 |
| The real household's name | #102, #162, #241, #242 |
| The owner's address and its plus-aliases | #52, #140, #142, #241, #293 |
| Test-household names naming live rows | #162, #241, #293, #349 |

One **false positive** is worth recording because the next screenshot will produce another: #80's
comment carried two UUIDs that were GitHub attachment ids, not rows. The scanner excludes them by the
URL they sit in rather than by issue number, so the rule stays true for the next one.

#### When each was written, and why that turned out to matter

*Measured 2026-09-10 from each place's own `created_at`* — the date an identifier was **written**,
not the date its issue was opened, which are eleven days apart on #162 and are the difference between
the two halves of this table.

| Written | Place | |
|---|---|---|
| 2026-08-26 | #140 comment 2, #142 comment 3 | |
| 2026-08-28 | #241 body, #242 comment 3, #246 comment 2, #247 body, #247 comment 1, #262 body | |
| 2026-08-29 | #279 body | |
| 2026-08-30 | #52 comment 2 | |
| 2026-08-31 | #162 comment 4, #241 comment 2, #293 body | **after** |
| 2026-09-05 | #349 comment 2 | **after** |
| 2026-09-08 | #102 comment 1 | **after** |

**Five of the fifteen places were written after the repository went public**, across five issues, and
#102's was written **2026-09-08 — nine days after, and two days before this decision**.

That is worth stating plainly because the comfortable version of this story is false. The first draft
of the rule in [`docs/access-model.md`](access-model.md) said all thirteen *"were written when it was
not [public] … not one of them was a mistake at the time"*, and framed the whole thing as a correct
habit overtaken by a surface change. **Ten of the fifteen places fit that description. Five do not.**
Nobody had decided anything different for those five; the habit simply continued after the ground
moved, which is exactly what a habit does and exactly why the rule below is a rule rather than a
reminder.

The AC that asked for this was AC 1's *"and when it was written"* clause. It was **not** answered in
the first draft of this section — the enumeration above was the class table alone — and the false
sentence is what the missing clause was hiding. The instrument requests `createdAt` now and prints a
date beside every place, so the next reader gets the dates without asking for them.

### The decision, and the cost of what was not chosen

**Redact in place, across all four classes, deleting nothing.** Applied 2026-09-10 to 15 places
across 13 issues; each edit was verified by re-reading the item from the API rather than from the
edit's own success response, and the search was then re-run and came back **empty with its positive
control passing on the same run** — which is what tells an instrument that found nothing apart from
one that can no longer find anything.

Each value became a stable label — `[redacted #328 — household 1 id]` — and the labels are
**entity-scoped**, so a household's name and its id share an index and a table that read
`| first | <name> | <id> |` still reads as one household. A first attempt lettered each class
alphabetically by value and paired household name A with household id B: it protected the values
perfectly and destroyed the record's meaning, which is the wrong trade in a repository whose whole
argument is that a measurement without its reasoning is worthless.

Two options were weighed and rejected, and both were defensible:

- **Accept and leave.** Cheaper, and it has a real argument behind it — see the next subsection, where
  two of the four classes turn out to be published by the repository itself regardless. Rejected
  because the *linkage* is not: a real family's name joined to a live household id, its member count
  and its roster's shape is a fact the tracker was publishing and nothing else was.
- **Redact and delete the comments.** The only route to true removal, and it reaches 10 of the 15
  places. Rejected because those comments are the evidence their own acceptance criteria were ticked
  against — #162's and #241's especially — and deleting a measurement to protect a value it no longer
  contains trades the wrong thing away.

**Redaction is a reduction in exposure and not a removal, and this is measured rather than assumed.**
*Measured 2026-09-10 on #158*: the GraphQL `userContentEdits` field returns the **full prior body
text** of every edit, three revisions deep. So every value redacted above is still stored and still
served. Choosing redaction is choosing to lower the odds a passer-by sees it, not to make it unseen.

**The limit on that measurement, stated rather than glossed:** the query was authenticated as the
repository's owner, and nothing here establishes what GitHub returns to a stranger. The safe reading
is that edit history is as public as the issue it belongs to — which is what the decision above was
taken against — but *"anyone can read it"* is an assumption and *"it is still stored and served"* is
the measurement. Anyone re-pricing this decision should re-measure that from an unprivileged account
rather than inherit this sentence.

There is an asymmetry inside that, and it decides what the third option could ever have bought: a
**comment** can be deleted outright, and a **body** can only be edited. Five of the thirteen carry
their identifiers in the body (#241, #247, #262, #279, #293), so for those, nothing short of deleting
the whole issue removes anything at all.

### Two things that make the exposure smaller than it looks, and one that does not

*Both measured 2026-09-10, and both cut against redacting at all — recorded because a decision whose
counter-argument is missing reads as unconsidered.*

- **The surname is published by the repository, on purpose.** `LICENSE` line 3 and
  `docs/license-scope.md` carry it as tracked files. Redacting the household name from four issues
  does not conceal it and was never going to.
- **The owner's address is in every commit.** `git log --format='%an <%ae>'` prints it on the whole
  history of a public repository, and commit author metadata cannot be edited without rewriting
  history. Redacting it from five issues changes almost nothing about who can find it. *(The command
  is given rather than its output, and the reason is worth a sentence: the first draft of this bullet
  quoted the name and address verbatim — into the one surface Decision 2 is about, in the same commit
  that adds a rule forbidding exactly that. It was caught by grepping the diff, not by a check.
  See the note below.)*

What is **not** covered by either is the class that motivated the decision: household ids, member ids
and `auth.users` ids exist nowhere outside the live project and the tracker, and the join between
them and a real family existed only here. That class is the reason the answer is redact rather than
accept, and it is worth being clear that it is carrying the decision alone.

None of those ids is a credential — row-level security gates on membership, never on knowing an id
— so this is a privacy decision and not a security one. Recorded plainly because "identifiers were
exposed" invites a reader to assume otherwise.

### Can anything enforce this? Partly, and only after the fact

**Yes for detection, never for prevention, and the second half is structural.** GitHub offers no
write-time hook on an issue or a comment — there is no pre-receive equivalent a repository can
install — so the earliest anything can fire is after the value is published. The honest claim is *a
value that lands here is found*, never *a value cannot land here*.

[`.github/workflows/tracker-scan.yml`](../.github/workflows/tracker-scan.yml) runs the shape half on
every event that writes tracker text — the trigger list lives in the workflow and is deliberately
not copied here, since copying it is how one wrong word landed in three files. **There is no
schedule**: `gate.test.js`’s `#98 AC 5` refuses `schedule:`/`cron:` under `.github/workflows` with no
exemption, and the daily run was weighed at the owner’s gate and dropped rather than putting the
first door into that guard. `main()` is event-blind and re-paginates the whole tracker on any
trigger, so what the schedule would have bought is a bounded-latency guarantee, not coverage. It
needs no secret and
fails the run on a finding. **It prints item numbers and match classes only**: this repository is
public, so its Actions logs are public, and a check that printed the identifier it caught would
publish it a second time on a surface with no edit history to redact. `assertReportCarriesNoValues`
holds that mechanically rather than by care.

The **term half does not run in CI**, and that is a decision rather than a limitation. Its search
terms are the live household names and member addresses; putting them into an Actions secret to
detect their publication would create a third home for values Decision 2 spends an entire guard
keeping out of version control. It runs locally with `--names-file`, and the script states which
halves ran on every invocation — a run that quietly skipped the term half and reported clean would be
the failure this whole section is about.

So: the shape half is enforced, the term half is a convention with a local instrument, and neither is
preventive. What a story may record in the first place is in
[`docs/access-model.md`](access-model.md) under *What a story may record about the live project* —
linked rather than copied, so there is one copy to correct.

#### The gap found by walking into it, and what closed it: `docs/` is inside the guard now

This subsection recorded an open gap until #409 closed it on 2026-09-10. What follows is what was
decided, and the estimate that turned out to be wrong is kept rather than quietly dropped, because it
is the reason the work was deferred at all.

**How it was found.** A first draft of the bullet above quoted the owner's real name and address
verbatim, three paragraphs after this record says *"the values are deliberately not repeated here"*,
and in the same commit as a new rule forbidding it. Nothing went red — `README.md` and `docs/*.md`
were in no corpus, so the document that *records* Decision 2 was covered by it as a convention and by
no check. It was caught by grepping the diff, which is a thing a person has to remember to do.

**The estimate that deferred it was wrong by two orders of magnitude, and that is the finding worth
carrying.** #328 predicted a flood — the docs quote fixture names and `PLACEHOLDER_NAMES` entries by
the hundred, and this repository already records #170, where a source-text corpus widened from 2
files to 47 produced 118 findings and not one was a defect. *Measured 2026-09-10 with the real guard,
before anything was changed*: **15 files, 4 shape findings, 0 position findings.** All four were
declared, and **not one was a person or a household** — a rebalance scenario name, a button label, a
value inside a quoted third-party API response, and a product name from press coverage. The estimate
was expensive and the measurement cost one run.

**Why it was so small, which is the same reason it was not sufficient.** Both of Decision 2's literal
scans match *straight-quoted* strings, and prose does not quote that way. *Measured on a five-case
probe planted in `docs/`*: a name in bare prose, a name in typographic quotes, and a name in
backticks were **all missed**; only the two straight-quoted cases were caught. The bare-prose case is
the shape the incident above actually took. So widening the corpus alone would have given `docs/` a
check that could not catch the defect it was written for, while reading as coverage.

**So the documents are covered by two rules, not one:**

| rule | catches | blind to |
|---|---|---|
| The **literal scans** above, corpus widened to `README.md` and `docs/*.md` | a fixture-style quoted literal pasted into a document | anything not in straight quotes, which is most of prose |
| A **prose scan** — `classify` from [`scripts/scan-tracker.mjs`](../scripts/scan-tracker.mjs), the #328 tracker matcher, reading the same files for UUID- and address-shaped strings | the *address* half of the incident above, and any live row id | a real name in a sentence |

The prose scan is reused rather than reimplemented: a second copy of a matcher is a second thing to
correct, and that one already carries its placeholder-domain list, its nil-UUID skip and its
attachment-URL exclusion, each with a measured reason. Markdown is stripped of **nothing** before
either scan — comment-stripping exists because a comment quoting a name is prose *about* a fixture,
and in a document every line is prose, so stripping could only ever hide a name.

**What no check here reaches, stated plainly.** A real household or member **name written in bare
prose**. No shape distinguishes it from any other capitalised phrase, and a matcher for that would
flag every proper noun in every document — #170's flood, arriving for a reason nobody could triage
away. This is Decision 2's founding argument unchanged: no check can recognise a name it has not been
shown. That case belongs to `npm run scan:tracker -- --names-file <path>`, whose term half searches
for the live project's actual names and is deliberately local, and to a human reading the diff. The
pair narrows the gap; it does not close it, and a reader should not take a green suite as saying
otherwise.

One exemption exists, declared in band with its reason and asserted still needed the way `NOT_NAMES`
entries are: a UUID that trails a Claude artifact URL names an artifact rather than a row here. It is
keyed on the URL **prefix** rather than on the id, so it stays true for the next such link — and so
that the file whose subject is keeping identifiers out of documents does not itself carry one.

**Revisit when** the repository's visibility changes again in either direction; when GitHub gains a
write-time hook on issue content, which would move the term half from convention to gate; or when a
household organised by somebody who is not the owner appears on the live project, at which point
*accept and leave* stops being available as an option for anything.

---

## What this record does not decide

- **Row-level security.** #5's AC 6, `docs/access-model.md`. One criterion with two owners is one
  criterion nobody owns.
- **Which migrations are live.** `docs/access-model.md` tracks that, and it is a fact about the
  Supabase project rather than about this repository.
- **Google Calendar content.** ~~The charter's amendment (PR #94) settles that only derived busy
  minutes are stored. When #95 lands, cohssa control 3 becomes relevant here for the first time and
  this section is the place to reopen it.~~ **Discharged 2026-09-04.** #95 landed on 2026-08-24 and
  control 3 was reopened where it lives — *Re-read 2026-09-04 — control 3* under Decision 3, which
  also corrects the attribution in the struck sentence. The minimization rule is real and was ratified
  at the 2026-08-16 groom gate, recorded in **#96's body**; PR #94 hands the question to grooming
  rather than settling it. Struck rather than deleted so the misattribution stays findable by anyone
  who read this record before today.

## What this re-read did NOT change, and why

A *stands* that costs nothing to write is indistinguishable from a paragraph nobody re-read. Each of
these was examined on 2026-09-04 and deliberately left alone.

- **Decision 1, in full.** Standard Protection, the custom domain, the ordering in
  `docs/deploy-runbook.md` step 6, every cost line including *"reversing is free and instant"* — all
  unchanged, and all three measurable rows re-measured and holding. The trigger fired and the answer
  is genuinely *stands*: what the re-read adds is a premise written down and a sharper replacement
  trigger, not a revision.
- **The rejected alternatives under Decision 1.** A separate Supabase project for Preview and
  unsetting the Preview variables were both re-read against a two-household world and neither
  verdict moves: the staging project still costs every migration pasted twice, which is this repo's
  measured worst failure, and a preview that reaches no database is still useless for exercising a
  data flow. A second household makes the *first* one more attractive in principle and does not touch
  the reason it was rejected.
- **Decision 2, entirely.** The vocabulary, the three assertions, the audit of `Alex`/`Robin`/`Sam`
  against the real household, and the positive-vocabulary-not-denylist design. The repository going
  public raises what a miss costs and changes nothing about what the guard should do — and the
  guard's own comment had already said that a name in git is exposed *"to whatever the hosting
  arrangement happens to be on the day"*, which is this event, correctly anticipated.
- **The 2026-08-20 scan under Decision 2 was not re-run**, and is not claimed as current. It is dated
  and left dated. `npm test` re-runs its executable half on every commit, which is the part a
  re-reading of prose could not verify anyway.
- **cohssa controls 1, 2 and 4.** Control 1's hazard is Sheets having no column-level permission and
  Postgres still has column grants; control 2 still has no second file and no group; control 4 is
  still Decision 2 by another name. A second household changes the *volume* of data behind each and
  none of the reasoning.
- **The copyright line in `LICENSE` and `docs/license-scope.md`.** They carry the owner's real
  personal name, which is a deliberate attribution and not a fixture — outside Decision 2's subject
  by intent rather than by oversight. Named here because it is the obvious thing to flag on a public
  repository, and flagging it as a finding would be wrong.
- **The data-class comparison with cohssa.** Names, weekly minutes, chores and completion behaviour
  against medications and diagnoses for 31 minors. Two households is still not that, and the record
  should keep declining to borrow the alarm.

## Triggers as they stand after this re-read

Both original triggers are discharged and neither was deleted. Every decision here now carries at
least one live condition, so no reader inherits a *revisit when* list whose entries have already
happened:

| where | live conditions |
|---|---|
| Decision 1 | Vercel's exemption behaviour; **a household organised by somebody who is not the owner**; the membership half firing (#173); a legitimate preview viewer with no Vercel login; a policy-weakening migration; anything reaching the client RLS does not gate |
| Decision 2 | **none, deliberately.** Its enforcement is executable and reddens on its own in CI, so it needs no date-based trigger; the two things that would change it — a name being added to the vocabulary, or the corpus being narrowed — are both diffs a reader sees. Stated rather than left blank, so an empty cell is not read as an oversight |
| Decision 3, control 3 | a third scope; anything proposing to STORE a field the `calendar-events` response carries (re-read at #101's pickup, 2026-09-08 — the widening itself is settled there) |
| Decision 3, control 5 | visibility changing again, in either direction; or a check gaining the ability to read the tracker |
| Decision 3, control 6 | a client-role grant proposed on `calendar_tokens`; a second provider; a credential of that class stored any other way |
| Decision 4 | a second invitation channel; household names ceasing to be family names; anything added to a pre-redemption surface |
