-- What a member's calendar says about one week — story #96.
--
-- The connection landed in `0011`; nothing read it. This is the table the read
-- writes into, and it is deliberately the SMALLEST table this repo has ever
-- added, because every column here is a column of somebody's calendar sitting
-- in a household database.
--
-- ===========================================================================
-- DATA MINIMIZATION IS THE SCHEMA, NOT A CONVENTION
-- ===========================================================================
--
-- Owner decision at #96's groom gate, 2026-08-16: derived busy-minutes only.
-- Raw-event caching was rejected outright as the biggest privacy surface this
-- app would hold, and compute-per-request was rejected as trading away the
-- audit trail while paying a Google call per render.
--
-- So the columns below are the WHOLE stored shape — `member_id`,
-- `period_start`, `busy_minutes`, `event_count`, `computed_at` — and there is
-- no column here that could hold a title, an attendee, a location or an event
-- time. That is the point: a rule written in an Edge Function is a rule one
-- careless `insert` away from being false, and a rule written as an absent
-- column cannot be broken without a migration somebody has to review.
--
-- `event_count` is a count of the BUSY INTERVALS Google returned, before they
-- were coalesced — not a count of events, which the free/busy API never says.
-- It is here so a figure that looks wrong can be told apart from a figure
-- computed off an empty answer: 0 minutes from 0 intervals is an empty week,
-- and 0 minutes from 4 intervals is a bug. Nothing renders it today.
--
-- ===========================================================================
-- WHO WRITES, AND WHY THAT IS THE SAME ANSWER AS `0011`
-- ===========================================================================
--
-- Only `service_role`, from `supabase/functions/calendar-busy`. The figure is
-- derived from a credential no client can reach (`calendar_tokens` has no
-- client grant at all), so a client-written row would be a number nobody could
-- check against anything. `authenticated` holds SELECT on the readable columns
-- and nothing else — no insert, no update, no delete, and no policy for them
-- either, so a grant added by accident later still reaches no row.
--
-- ===========================================================================
-- Idempotent, like every migration here
-- ===========================================================================
--
-- `create table if not exists` with the constraints declared INLINE (on a
-- re-run the whole statement is skipped and inline constraints go with it),
-- `drop policy if exists` before the policy, and grants, which are idempotent
-- by nature. Re-runnable against the schema this file was written for, which is
-- the only claim any migration here makes.

-- ---------------------------------------------------------------------------
-- 1. The derived figure
-- ---------------------------------------------------------------------------

create table if not exists public.calendar_busy (
  id           uuid primary key default extensions.gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  member_id    uuid not null,

  -- The Monday the week begins on, in the HOUSEHOLD's zone — the same key
  -- `member_capacity` uses, so the two are joinable on `(member_id,
  -- period_start)` without either learning the other's calendar arithmetic.
  period_start date not null,

  -- Whole minutes of coalesced busy time in that week. Bounded by the length of
  -- a week for `member_capacity`'s reason: a figure outside it is arithmetic
  -- that went wrong, and a check constraint is the only reader that will ever
  -- notice at the moment it happens.
  --
  -- 10140, not `member_capacity`'s 10080, and the sixty minutes are real. A
  -- week here is seven LOCAL days in the household's zone, and the one holding
  -- a fall-back transition is 169 hours long — so a calendar busy for the whole
  -- of it reduces to exactly 10140, which a 10080 bound would refuse (or, as
  -- the first version of the Edge Function did, silently clamp to the ceiling,
  -- understating that week by an hour while landing on the one value this
  -- constraint exists to make suspicious). Found by review-fanout, 2026-09-04.
  -- `MAX_BUSY_MINUTES` in the function is the same number; a test holds them
  -- equal.
  busy_minutes integer not null,

  -- How many intervals that figure was reduced FROM. See the docblock: this is
  -- what separates an empty calendar from a broken reduction.
  event_count  integer not null default 0,

  computed_at  timestamptz not null default now(),

  -- One row per member per week. A second read of the same week is a CORRECTION
  -- of the same fact rather than a second fact — #98's refresh story upserts on
  -- this key, and an accumulating table would make "the current figure" a
  -- question with no answer.
  constraint calendar_busy_one_per_period unique (member_id, period_start),

  constraint calendar_busy_minutes_range
    check (busy_minutes >= 0 and busy_minutes <= 10140),

  constraint calendar_busy_event_count_range check (event_count >= 0),

  -- 0005's rule, restated because it is the one that makes the key mean
  -- anything: `WEEK_STARTS_ON` in src/lib/capacity.js is Monday, and a row filed
  -- under any other weekday cannot exist. `isodow` is 1 for Monday. The client
  -- resolves the week through `periodStartFor`; this is what stops a hand-built
  -- call filing a figure under a key nothing will ever read.
  constraint calendar_busy_period_is_week_start
    check (extract(isodow from period_start) = 1),

  -- COMPOSITE, for the reason `0010` and `0011` give: the member and the
  -- household this row claims must be the same household, so a row pairing one
  -- family's person with another family's id cannot exist. The cascade means a
  -- removed member takes their derived figures with them, exactly as they take
  -- their connection and their token.
  constraint calendar_busy_member_in_household
    foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade
);

comment on table public.calendar_busy is
  'Derived busy-minutes per member per week, reduced from Google free/busy. '
  'Holds NO event title, attendee, location or time — the stored shape is the '
  'whole minimization decision (owner, 2026-08-16). Written only by the '
  'calendar-busy Edge Function as service_role. Story #96.';

create index if not exists calendar_busy_household_period_idx
  on public.calendar_busy (household_id, period_start);

-- ---------------------------------------------------------------------------
-- 2. Row-level security — which ROWS
--
-- The household is the trust boundary, and inside it the roster is visible to
-- everyone — the same answer `calendar_connections` gives, for the same reason.
-- A housemate's busy figure is the same class of fact as their weekly minutes,
-- which the roster has always shown, and #97 will offer it as a prefill beside
-- a capacity figure the whole household can already read.
--
-- No INSERT, UPDATE or DELETE policy, and no grant to match. The Edge Function
-- writes as `service_role`, which bypasses row-level security — so a policy for
-- it would be inert, and a policy for `authenticated` would be a second way in
-- for a write that must have exactly one.
-- ---------------------------------------------------------------------------

alter table public.calendar_busy enable row level security;

drop policy if exists calendar_busy_select_same_household on public.calendar_busy;
create policy calendar_busy_select_same_household
  on public.calendar_busy for select to authenticated
  using (household_id in (select public.current_household_ids()));

-- ---------------------------------------------------------------------------
-- 3. Privileges — which COLUMNS, and for whom
--
-- `service_role` is granted EXPLICITLY, and the reason is the one thing here a
-- green suite could not tell you: it bypasses row-level security and does NOT
-- bypass grants, and a freshly created table on the hosted platform gives every
-- Data API role `Dxtm` — truncate, references, trigger, maintain — and no DML at
-- all. An Edge Function holding the service_role key would be refused 42501 on
-- its own table.
--
-- `0011`'s equivalent comment added, until #334, that the pglite harness
-- disagrees, being `grant all` and "deliberately more permissive than the
-- platform", so that a grant like this one is vacuous there. **That has not
-- been true since #91**, which narrowed the harness to the platform's real
-- default; the sentence was kept in 0011 and repeated in two test headers, which
-- is why it was contradicted here rather than quietly not copied, and #334 is
-- what corrected the other copies. *Measured 2026-09-04*: deleting the grant
-- below reddens `and service_role reaches only what the Edge Functions need` in
-- src/test/grants.pglite.test.js — predicted 1, actual 1. So this line is
-- load-bearing in production AND proven in CI, and the direction rule that
-- decides which is which is written out in that file's own header.
--
-- The revokes come first and name `anon` alongside `authenticated` for 0002's
-- reason: no policy above targets `anon`, so it cannot reach a row today — but
-- that is one `to anon` away from being false. Note what they no longer buy,
-- since the same #91 change: on a fresh table the client already holds no DML,
-- so the revoke is the house convention rather than the thing refusing a client
-- write — *measured*, deleting it reddens 3 assertions and not the 9 predicted.
--
-- `household_id` is withheld from the select grant, matching 0003, 0005, 0010
-- and 0011. The client scopes this table from the already-scoped member set
-- (`listBusyWeeks` takes member ids), so it needs no household column — and
-- withholding one is what makes `select('*')` FAIL OUTRIGHT here, so a
-- forgotten column list is a loud error rather than a quiet superset.
-- ---------------------------------------------------------------------------

revoke all on public.calendar_busy from authenticated, anon;

grant select (id, member_id, period_start, busy_minutes, event_count, computed_at)
  on public.calendar_busy to authenticated;

grant select, insert, update, delete on public.calendar_busy to service_role;
