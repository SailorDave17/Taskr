# How capacity works, and when a week begins

- Story: #44 — store capacity for a week, not just a standing baseline
- Decided by: owner (SailorDave17), at pickup of #44, 2026-08-08
- Migration: `supabase/migrations/0005_weekly_capacity.sql`; `0031_calendar_capacity_source.sql`
  widens `source` (#97); `0039_calendar_auto_apply.sql` widens it again and adds
  `previous_minutes` (#106)
- Module: [`src/lib/capacity.js`](../src/lib/capacity.js)

## Baseline and override, not a replacement

`members.weekly_minutes` is the **baseline** — what a person usually has — and it is **unchanged**
by this story. `member_capacity` holds the **override**: what they have *this* week.

**The absence of a row is the normal case.** That is the whole design. Next week returns to normal on
its own, so there is no backfill, no scheduled job, and nothing to clean up. One function resolves the
two:

```js
effectiveCapacity(member, override)   // override where a row exists, baseline otherwise
```

**An override of zero must win.** The obvious spelling — `override?.minutes || baseline` — silently
returns the baseline for the person who has just said they have no time at all this week, which is
the case the feature most exists to serve. The *presence* of the row decides, never the truthiness of
its value. There is a test named for exactly that.

## Why this story exists at all

The charter's complaint about every competitor is that they treat capacity as a constant. Until this
migration Taskr did too: a single static integer per person, edited by hand in `Roster.jsx`, with
nothing owning the delta when somebody's week was unusual. That is capacity-as-constant wearing a
different name, and it is the precondition of the signature moment — a split cannot respond to a week
it cannot see.

The allocator (#40) was deliberately built to be *given* capacity rather than to read it, so this
story changes nothing inside it. A test asserts the allocator still cannot see `weekly_minutes`.

## The week begins on Monday

**Owner decision, 2026-08-08.** ISO 8601.

The reason that outweighed the others: **Postgres computes it natively.** `date_trunc('week', ts)` is
already Monday-based, so the period key has exactly one implementation in SQL and its JS counterpart
derives the same boundary the same way. It also keeps the weekend inside a single period rather than
splitting it across two, and the weekend is when household chores actually happen.

| Option | What it would have cost |
|---|---|
| **Monday (chosen)** | US calendars render Sunday-first, so a future week grid must be told the period boundary rather than inferring it from the locale. |
| Sunday | No native truncation — explicit offset arithmetic in **both** SQL and JS, so two implementations of one boundary. That is precisely the drift AC 7 makes a test about. Splits the weekend across two periods. |
| Saturday | Same double implementation as Sunday, plus it is unconventional enough that every reader has to be told, and no calendar UI renders it without configuration. |

**The constant has teeth.** `WEEK_STARTS_ON` / `WEEK_START_ISO_DOW` in `capacity.js` are matched by a
check constraint in 0005 — `extract(isodow from period_start) = 1` — so a row filed under any other
weekday **cannot exist**. A test reads the constraint out of the migration and compares it to the
constant, so changing one without the other fails rather than drifts.

## The timezone lives on the household, not on the device

`households.timezone`, defaulted from the creating device and editable by any member.

A week boundary is a local-time fact, and the ambient zone of whichever phone happens to ask is not
the household's. Two members in different zones must agree on which week it is, or their capacities
file under different keys and the split silently responds to two different weeks.

`periodStartFor(instant, timeZone)` is two-stage for a reason: resolve the instant to a local calendar
date in the household's zone, then do pure calendar arithmetic on that date in UTC. The second stage
touches no zone at all, so no daylight-saving transition can shift it — the classic bug here is
subtracting `n × 86400000` milliseconds across a DST boundary and landing an hour into the previous
day.

Tests run the same assertions with the **process** zone forced to `UTC` and to `America/New_York` and
require identical answers, with a positive control proving the process-zone flip actually takes
effect. Without that control both arms could agree because nothing changed.

**Postgres validates the zone with a trigger, not a check constraint.** The only source of truth is
`pg_timezone_names`, a view, so a function reading it is `STABLE` at best and a check requires
`IMMUTABLE`. An invalid zone stored here would not fail at write time — it would fail every later read
that computes a boundary, which is the worst possible place to find out.

## Access rules

Row-level security scopes rows to the device's household. Column grants decide which columns, because
**RLS is row-level and says nothing about columns** — 0002 measured that hole on shipped code, where a
correct `claim_member` guard was bypassed by a direct `UPDATE`.

| Privilege | Columns | Why |
|---|---|---|
| `select` | everything except `household_id` | Matches 0003's convention on chores: it is written on insert and never read back, since RLS already guarantees every visible row belongs to this household. Excluding it also makes `select('*')` **fail outright** rather than quietly omit a column. |
| `insert` | `household_id, member_id, period_start, minutes, note, source, previous_minutes` | `id` and `created_at` are the database's to say. A client that can write `created_at` can file this week's capacity as last week's. `previous_minutes` is `0039`'s (#106). |
| `update` | `minutes, note, source, previous_minutes` | Only what a *correction* changes. `member_id` and `period_start` identify whose week it is; moving an override between people or weeks is a delete plus an insert. |

*(`0022` later widened SELECT to `household_id` and UPDATE to the three identity columns, because a
PostgREST upsert names every payload column in its `DO UPDATE SET` and reads each through
`EXCLUDED`; `capacity.pglite.test.js` holds the exact sets.)*

A composite foreign key ties `(member_id, household_id)` to the members table, so an override cannot
name a member of one household while claiming another — such a row would be visible to the wrong
family while pointing at a member they cannot see.

## Where a figure came from — `source`

Every override row says how it was entered, so a later accuracy question is answerable from the
data rather than from memory (#57 AC 5). `member_capacity_source_known` admits exactly four words,
and `CAPACITY_SOURCES` in `capacity.js` is held equal to the constraint by a test:

| `source` | What it means | Since |
|---|---|---|
| `manual` | A person typed the number. | #46 (0005) |
| `extraction` | A person described their week in a sentence and accepted the figure proposed from it, edited or not — a corrected interpretation is still derived from the description (#210 AC 6). | #210 |
| `calendar` | A person tapped *Use this* on the calendar's suggestion and saved it **unedited**. The suggestion is `max(0, baseline − busy_minutes)` (owner decision, 2026-08-16); a figure they changed first is no longer the calendar's and saves as `manual` (#97 AC 2). | #97 (0031) |
| `calendar_auto` | **Nobody tapped.** A calendar read landed, the suggestion was within the bound below, and the app wrote it. The row also carries `previous_minutes` — the figure the week resolved to a moment before — so the roster can show both (#106 AC 4). A person who re-opens the week and saves it unedited has now confirmed it, and it becomes `calendar`; edited, it becomes `manual`. | #106 (0039) |

Two rules that hold whatever the word:

- **A proposal is a prefill, never a write** — with one bounded exception, decided by the owner and
  recorded in the next section. Both proposers land a figure in the same field the typed path uses,
  name where it came from beside it, and the one Save is where the person agrees — a figure nobody
  saw is a figure nobody can defend when the split is challenged. The exception keeps that
  defensibility by other means: the row names itself as automatic, keeps the figure it replaced,
  and the change is announced.
- **The latest write wins, by the `(member_id, period_start)` upsert.** A typed figure replaces a
  calendar one and a calendar one replaces a typed one; nothing is sticky. That is the charter's
  manual floor made load-bearing: a person can always overtype what a machine suggested — and the
  automatic path below is the one writer that **never** overtypes a person.

`effectiveCapacity` never reads `source`. What put the row there is provenance for the roster to
show (a calendar-sourced week reads *set from calendar*, an automatic one *set from calendar
automatically (was N min)*); whether the row applies is decided by its presence alone, as above.

## A refreshed suggestion applies itself, within a bound — owner decision 2026-09-08 (#106)

- Story: #106 — auto-apply calendar capacity within a bounded delta
- Decided by: owner (SailorDave17), at pickup of #106, 2026-09-08, **before the live trust verdict
  #100 AC 4 still owes** — the story's own deferral named that verdict as the informed moment, and
  the owner chose to decide ahead of it with the tradeoff stated.
- Module: `autoApplyDecision` and `AUTO_APPLY_BOUND_MINUTES` in [`src/lib/capacity.js`](../src/lib/capacity.js)

The story filed three options and the owner took the third:

| Option | What it would have meant |
|---|---|
| Never | Propose-then-confirm stays the only path. Zero build cost, and the charter's signature moment — "re-balances without anyone having to negotiate it" — needs a tap forever. |
| Auto-apply, announcement only | Every refresh applies; #50's announcement is the visibility. Cheapest build and the widest exposure: a wrong free/busy read moves as much of the week as it likes before anyone sees it, which is the trust-erosion kill condition by name. |
| **Auto-apply within a bound (chosen)** | A refresh applies itself only when it moves the week by at most a named number of minutes; a larger move only proposes, exactly as before. The signature moment fires for the ordinary drift of a week, and the change big enough to argue about still gets a person. |

**The bound is `AUTO_APPLY_BOUND_MINUTES = 120`.** Two hours: a meeting or two of drift between one
twelve-hour refresh and the next applies itself; a trip, a sick day or a cleared calendar asks.
Rejected beside it: **60** (most real movement falls outside it, so the signature moment fires
rarely and the story would have bought a constant) and **240** (half a working day applies silently,
and a wrong read moves that much before anyone sees it). It is a delta on **the week's capacity**,
not on the busy figure and not on the previous suggestion. Measuring suggestion-to-suggestion was
rejected because a week sitting at its baseline could then be moved six hours by a read whose
suggestion had moved thirty minutes since the last one — the bound would be on the wrong thing.

**The bound is measured from the last figure a PERSON held — the anchor — not from the current
figure** (owner decision at the review escalation, 2026-09-08). `humanFigureFor` in `capacity.js`:
the baseline when there is no row; the row's figure for `manual`, `extraction` and `calendar` (a
tap-confirmed calendar figure is a person's act); and for a `calendar_auto` row its
`previous_minutes`, which *is* the anchor carried forward from the write before. The first draft
measured every step from the current figure, and the review priced what that allowed: three
refreshes could walk a week 360 minutes in 120-minute steps, each inside the bound, while *(was N
min)* named only the last step — a figure nobody chose. Anchoring caps cumulative drift at one bound
from what a person last held, and makes *(was N min)* always a person's figure. The cost, stated: a
week whose calendar genuinely keeps filling stops at the bound until somebody taps, which is the
propose-then-confirm path. Two figures, then, and they differ exactly on an automatic row: the
**current** figure decides *no change* (a suggestion equal to what is on screen writes nothing), the
**anchor** decides the bound and is what the write records.

**What it never overwrites — the manual floor, kept, in two halves.** The automatic path writes only
over **no row** or over a row the calendar already set (`calendar` or `calendar_auto`). A `manual` or
`extraction` row is a person's figure and the refresh only proposes over it, whatever the delta.
Rejected: *no row only* (an automatic week could never update itself again, so the second refresh
of every week would ask) and *any row, latest write wins* (#97's upsert rule, read literally — a
typed figure replaced by a machine within two hours is exactly the exposure the story warns about).
The **client half** is `autoApplyDecision`'s `person-set` refusal over a row re-read from the server.
The **server half** is `0039`'s trigger `member_capacity_automatic_never_overtypes` (errcode
`TA106`), because the client half is a read followed by a write, and a figure a person saves in the
one round trip between them would otherwise be overwritten with nobody tapping — the review found
the first draft's docs claiming *never* over exactly that hop. The trigger refuses `calendar_auto`
over `manual` or `extraction` and never refuses a person's word over anything; the App reads its
refusal as *a person won* — no error, no re-assignment, a re-read — rather than as a fault.

**Whose week, and when.** The signed-in member's own row, and nobody else's — the `calendar-busy`
function acts on `auth.uid()` (#96, owner decision 2026-09-04), so a housemate's week is written
when they open their own app. It fires at the one seam both calendar reads share — #96's first read
of a week and #98's refresh of a stale one — after the derived row has landed and been re-read, and
**both inputs it decides from — the override and the member row — are re-read from the server at
that moment** rather than taken from the screen, so a figure a housemate typed during the round trip
is seen and respected, and a baseline a housemate edited during it is the baseline the figure is
computed from (the first draft read the roster off the latest render; the review measured that as
current to within a Realtime echo and no better). It is client-triggered only, like every periodic
read here (#53's reason, held by `gate.test.js`), and it can run at most once per session per
(member, week) per trigger, because it sits inside the reads that are already bounded that way.

**What a member sees.** Three things, none of them optional:

1. **The roster names it.** The week reads *set from calendar automatically (was N min)* where
   the tap-confirmed week reads *set from calendar* — `previous_minutes` is the N, written by the
   same upsert as the figure, and always the last figure a person held (the anchor above). A person
   who opens that week finds the calendar's figure in the field with its source line; Save unedited
   is the confirm tap they never made, and the row becomes `calendar` with `previous_minutes`
   cleared; an edit makes it `manual` (#97 AC 2's rule).
2. **It is announced.** The write is followed by the same re-assignment a tap causes (#49), so
   #50's announcement fires for every member on their next look, and its cause sentence says the
   week was set from that member's calendar — an unattended change with no author named would read
   as the app moving somebody's week on its own, which it did, and it must say so. **Only when the
   whole change is the automatic write's own**: the statement nets everything since the viewer's
   last look (#50 AC 5), so the clause is attached only when the figure that viewer was last shown
   equals the `previous_minutes` the automatic row recorded (`automaticCauseSources`). A person's
   change followed by an automatic one gets the plain cause sentence, which is true of it — the
   review found the first draft labelling a person's 200 minutes the calendar's, and a cleared
   override followed by an automatic write carrying the wrong sign.
3. **Nothing is announced for nothing.** A read whose suggestion equals the week's current figure
   writes nothing, so a refresh that confirms what is already there costs no row, no re-assignment
   and no event (#50 AC 8's rule, inherited).

### One thing 0005 deliberately did **not** narrow

`households` gains its first `UPDATE` policy here, so the update surface is column-granted to
`name, timezone` — otherwise any member could rewrite `join_code` or reassign `organizer_member_id`,
which is 0002's hole reopened.

**`SELECT` on `households` is left alone on purpose.** `listHouseholds()` in
[`src/lib/household.js`](../src/lib/household.js) issues `select('*')`, which a column grant makes
**fail outright**. *(This named `currentHousehold()` until #164, which replaced that function with
`listHouseholds()` plus a pure `resolveActiveHousehold()`. The reason below is unchanged, because the
`select('*')` moved with it — but the name had to, or this paragraph would point at nothing.)* #44 asks for per-column grants on *new* tables, which `households` is not, so
narrowing the read surface there is a separate change with its own caller migration and does not ride
in on this one. A test asserts that `select('*')` still works.

## Both halves of this shipped on 2026-08-09

- **`0005` is applied to the live project** (#45, closed 2026-08-09). The migration status and the
  excused-red set are carried in [`docs/access-model.md`](access-model.md) — read them there rather
  than trusting a figure copied onto this page, because a live-project status claim's falsifying
  event is an action outside this repo and a third copy is what goes stale.
- **The screen exists** (#46, closed 2026-08-09). [`src/components/Roster.jsx`](../src/components/Roster.jsx)
  renders this week's number through `effectiveCapacity`. The sentence this section used to carry —
  "`Roster.jsx` still renders the baseline" — was true only before #46 and had been false for three
  weeks.

The heading matters as much as the bullets. It read *What is not done here* while every claim under
it was false, and a reader opens a not-done section precisely to learn what is outstanding — so a
stale one is worse than a stale sentence elsewhere.
