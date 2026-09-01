# How capacity works, and when a week begins

- Story: #44 — store capacity for a week, not just a standing baseline
- Decided by: owner (SailorDave17), at pickup of #44, 2026-08-08
- Migration: `supabase/migrations/0005_weekly_capacity.sql`
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
| `insert` | `household_id, member_id, period_start, minutes, note, source` | `id` and `created_at` are the database's to say. A client that can write `created_at` can file this week's capacity as last week's. |
| `update` | `minutes, note, source` | Only what a *correction* changes. `member_id` and `period_start` identify whose week it is; moving an override between people or weeks is a delete plus an insert. |

A composite foreign key ties `(member_id, household_id)` to the members table, so an override cannot
name a member of one household while claiming another — such a row would be visible to the wrong
family while pointing at a member they cannot see.

### One thing 0005 deliberately did **not** narrow

`households` gains its first `UPDATE` policy here, so the update surface is column-granted to
`name, timezone` — otherwise any member could rewrite `join_code` or reassign `organizer_member_id`,
which is 0002's hole reopened.

**`SELECT` on `households` is left alone on purpose.** `currentHousehold()` in
[`src/lib/household.js`](../src/lib/household.js) issues `select('*')`, which a column grant makes
**fail outright**. #44 asks for per-column grants on *new* tables, which `households` is not, so
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
