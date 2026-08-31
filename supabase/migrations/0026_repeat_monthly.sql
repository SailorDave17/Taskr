-- A chore that repeats monthly on a chosen day of the month — story #103.
--
-- The first of the two follow-ups `0012`'s own comment names ("Monthly
-- schedules and exception dates are #103 and #105"); #105 landed first, so the
-- pass this file replaces is `0025`'s exception-aware body, not `0012`'s.
--
-- ===========================================================================
-- The ratified short-month rule: CLAMP to the month's last day
-- ===========================================================================
--
-- Owner decision, 2026-08-16, at the groom gate. A day-31 chore fires on
-- Feb 28 (Feb 29 in a leap year, Apr 30 in a 30-day month) rather than
-- silently vanishing four to five months a year. The rejected alternative is
-- RFC 5545's skip-the-month: literally honest dates, but a monthly bill chore
-- not appearing in February is not what a household wants.
--
-- The rule lives in ONE predicate, inside `repeat_occurrence_dates` below: a
-- date matches a monthly schedule when its day-of-month equals
-- least(the chosen day, the last day of its own month). Everything else —
-- exactly-once, the catch-up bound, exceptions, the watermark, the household's
-- zone — is the machinery `0012` and `0025` already built, and a monthly
-- occurrence flows through all of it as an ordinary generated chore.
--
-- ===========================================================================
-- Why the schedule function is DROPPED and recreated, not replaced
-- ===========================================================================
--
-- `repeat_occurrence_dates` gains a parameter, and `create or replace` with a
-- changed signature ADDS AN OVERLOAD rather than replacing — the ambiguity
-- `describeRpcError` documents under PGRST203, and pglite would carry both
-- forms silently. Neither form is callable by any client (its execute is
-- revoked below, as it always was), so the drop breaks no caller: the only
-- consumer is `catch_up_repeats_at`, whose plpgsql body resolves at call time
-- and is replaced in this same file.
--
-- The parameter order mirrors the JS copy in `src/lib/dueDates.js`
-- (`upcomingOccurrenceDates`): kind, weekdays, monthday, then the interval.
-- Same convention as before — the SQL is the authority on what the pass
-- CREATES, the JS only decides what the skip picker OFFERS, and the suite
-- holds the two equal.
--
-- ===========================================================================
-- The catch-up bound is KIND-DEPENDENT from here on
-- ===========================================================================
--
-- Owner decision, 2026-08-31, at this story's commit gate, taken on a review
-- escalation. `catch_up_bound_days = 7` was ratified on 2026-08-24 when the
-- only kinds were daily and weekly, and for those it costs at most a week of
-- chores. Put a MONTHLY schedule under the same number and it silently drops
-- the whole month: a household that does not open the app within seven days
-- of the fire date loses that occurrence entirely, which for a rent chore is
-- the feature's headline case failing in silence.
--
-- So the bound is now expressed per kind: seven days for daily and weekly,
-- exactly as before, and ONE INTERVAL for monthly — a missed monthly
-- occurrence is caught up if it fired within the last month, and skipped if
-- an entire further month has passed. The rejected alternatives are recorded
-- because a bound is the kind of number that gets "simplified" later: keeping
-- 7 universally was cheapest and accepts the silent drop, and exempting
-- monthly from the bound altogether would let a chore dated weeks ago appear
-- as new work, which is the pile-on the bound exists to prevent.
--
-- This is `a-ceiling-that-holds-is-not-a-fit-2026-08-13` caught before it
-- shipped rather than after: a constant whose justification named one subject
-- while the constant came to govern several. The daily/weekly arm is
-- unchanged, so nothing that was decided in August is being re-decided here —
-- what is added is the arm that number was never asked about.
--
-- ===========================================================================
-- What the trigger already does for monthly, for free
-- ===========================================================================
--
-- `set_repeat_since` (0012) fires on any repeat_kind write and keys on
-- 'none' versus everything else, so a monthly repeat is stamped with the
-- household-local date it was switched on and un-stamped on switch-off with
-- no change here. Likewise `chores_occurrence_does_not_repeat`,
-- `chores_one_occurrence_per_date`, the catch-up bound and #105's exception
-- probe: none of them mention a kind, which is the payoff of #53 keeping the
-- schedule a pure function of dates.
--
-- ===========================================================================
-- Re-runnability, and the same ordering hazard 0025 names
-- ===========================================================================
--
-- Applied by `npm run migrate:live` or a hand paste; a re-paste is the normal
-- path. The column uses `add column if not exists`; the widened kind
-- constraint and the new shape constraint are dropped by name and recreated,
-- which is idempotent end-to-end; the functions are drop-if-exists + create
-- (the schedule) and `create or replace` (the pass); the privilege statements
-- are idempotent.
--
-- THE HAZARD, and the two halves are NOT equally bad — the difference is the
-- whole point of writing it down. Both `0012` and `0025` carry their own
-- `catch_up_repeats_at`, so re-pasting either one on top of this file
-- replaces the pass. What happens next differs:
--
--   * Re-pasting `0012` degrades to a MONTHLY-BLIND pass. `0012` recreates
--     the four-parameter `repeat_occurrence_dates` in the same file, so its
--     body resolves and daily and weekly keep generating; monthly chores
--     quietly stop. Bad, and survivable.
--
--   * Re-pasting `0025` BREAKS EVERY KIND. Its body calls the four-parameter
--     signature that section 2 below DROPS, and `0025` does not recreate it —
--     so from that paste on, `catch_up_repeats()` raises for daily, weekly
--     and monthly alike, and `src/lib/chores.js` surfaces a hard error on app
--     open. The paste itself SUCCEEDS SILENTLY, because `create or replace
--     function` parse-checks a plpgsql body without resolving its callees;
--     nothing is wrong at apply time and everything is wrong at call time.
--     *Measured on PGlite (#103's review): CREATE succeeds, invocation
--     answers `function … does not exist`.*
--
-- The repair for both is re-pasting THIS file. The whole-list-in-order re-run
-- stays safe, which is what `migrations.pglite.test.js` proves — and note
-- what that suite does NOT cover: `databaseThrough('0025…')` builds a schema
-- through `0025` only, so no test ever places `0025` on top of `0026`. The
-- protection here is this paragraph, not a check.
--
-- Re-pasting `0012` does NOT narrow the kind constraint back: its guard is
-- `if not exists`, and the constraint exists.

-- ---------------------------------------------------------------------------
-- 1. The column and the constraints
-- ---------------------------------------------------------------------------

alter table public.chores
  add column if not exists repeat_monthday smallint;

do $$
begin
  -- Widened, not new: 'monthly' joins the kinds. Drop-and-recreate is the only
  -- way to change a CHECK, and it is what makes this file's paste actually
  -- widen a project that already has the old constraint.
  if exists (select 1 from pg_constraint where conname = 'chores_repeat_kind_known') then
    alter table public.chores drop constraint chores_repeat_kind_known;
  end if;
  alter table public.chores add constraint chores_repeat_kind_known
    check (repeat_kind in ('none', 'daily', 'weekly', 'monthly'));

  -- The monthday travels with 'monthly' and only with it — the same shape rule
  -- `chores_repeat_weekdays_shape` states for weekly, and the two compose: a
  -- monthly repeat has weekdays null (that constraint) and a monthday (this
  -- one), so half a schedule cannot be stored whichever half arrives.
  -- 1..31 because 31 is a real choice — the clamp in the schedule function is
  -- what makes it fire in every month — and 0 or 32 is not a day of any month.
  if exists (select 1 from pg_constraint where conname = 'chores_repeat_monthday_shape') then
    alter table public.chores drop constraint chores_repeat_monthday_shape;
  end if;
  alter table public.chores add constraint chores_repeat_monthday_shape
    check (
      (repeat_kind = 'monthly') = (repeat_monthday is not null)
      and (repeat_monthday is null or repeat_monthday between 1 and 31)
    );
end
$$;

comment on column public.chores.repeat_kind is
  'none, daily, weekly, or monthly. A repeat is a property of the chore — '
  'there is no template object and no templates screen. Story #53; monthly '
  'is #103.';

comment on column public.chores.repeat_monthday is
  'Day of the month (1..31) a monthly repeat fires on, null for every other '
  'kind. In a month too short for it, the occurrence clamps to the month''s '
  'last day — the owner-ratified rule; skip-the-month was rejected. '
  'Story #103.';

-- ---------------------------------------------------------------------------
-- 2. The schedule, as a pure function of dates — now with monthly
-- ---------------------------------------------------------------------------

drop function if exists public.repeat_occurrence_dates(text, smallint[], date, date);

-- Every date strictly after `start_after`, up to and including `until`, that
-- the schedule matches. No table access and no clock — the callers own both.
-- Same contract as the four-parameter form it replaces; the monthly branch is
-- the one addition, and the clamp is ITS whole content: a date matches when
-- its day-of-month is least(monthday, its own month's last day), so day 31
-- fires on Feb 28 / Feb 29 / Apr 30 instead of skipping the month.
create or replace function public.repeat_occurrence_dates(
  kind text, weekdays smallint[], monthday smallint, start_after date, until date
)
returns setof date
language sql
immutable
set search_path = ''
as $$
  select d::date
  from generate_series(
         (start_after + 1)::timestamp, until::timestamp, interval '1 day'
       ) as g(d)
  where kind = 'daily'
     or (kind = 'weekly' and extract(isodow from d)::smallint = any (weekdays))
     or (kind = 'monthly' and extract(day from d)::smallint = least(
           monthday,
           extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::smallint
         ));
$$;

comment on function public.repeat_occurrence_dates(text, smallint[], smallint, date, date) is
  'Schedule dates in (start_after, until]. Pure calendar arithmetic: no clock, '
  'no tables, no zone — the caller resolves all three. Monthly clamps a short '
  'month to its last day (#103''s ratified rule). Stories #53 and #103.';

-- ---------------------------------------------------------------------------
-- 3. The catch-up pass reads the monthday
-- ---------------------------------------------------------------------------

-- `0025`'s body — exceptions honoured in both the insert and the skipped
-- count — with `repeat_monthday` in the parent select and passed to both
-- schedule calls. Everything else is byte-for-byte 0025, and the comments
-- explaining the shape stay with 0012 and 0025.
create or replace function public.catch_up_repeats_at(as_of timestamptz)
returns table (created_count integer, skipped_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Daily and weekly: the 2026-08-24 owner decision, unchanged.
  catch_up_bound_days constant integer := 7;
  -- Monthly: one interval — owner decision 2026-08-31, reasoned in the header.
  -- A separate constant rather than a day count, because "one month" is not a
  -- fixed number of days and expressing it as one would reintroduce the clamp
  -- problem in the bound.
  catch_up_bound_months constant integer := 1;

  caller uuid := (select auth.uid());
  parent record;
  today_local date;
  after_anchor date;
  bound_floor date;
  made_now integer;
  skipped_now integer;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  created_count := 0;
  skipped_count := 0;

  for parent in
    select c.id, c.household_id, c.title, c.expected_minutes, c.due_on,
           c.repeat_kind, c.repeat_weekdays, c.repeat_monthday, c.repeat_since,
           c.repeat_caught_up_through, h.timezone
    from public.chores c
    join public.households h on h.id = c.household_id
    where c.repeat_kind <> 'none'
      and c.household_id in (select public.current_household_ids())
    order by c.created_at, c.id
    for update of c
  loop
    today_local := (as_of at time zone parent.timezone)::date;

    after_anchor := greatest(
      parent.due_on,
      parent.repeat_since,
      coalesce(parent.repeat_caught_up_through, parent.repeat_since)
    );

    -- The oldest date this pass may CREATE, per kind. `+ 1` in both arms so
    -- the window is inclusive of its own floor: seven days means today and
    -- the six before it, one month means today and everything back to the
    -- same day-of-month last month.
    bound_floor := case
      when parent.repeat_kind = 'monthly'
        then (today_local - make_interval(months => catch_up_bound_months))::date + 1
      else today_local - catch_up_bound_days + 1
    end;

    with made as (
      insert into public.chores
        (household_id, title, expected_minutes, due_on, generated_from)
      select parent.household_id, parent.title, parent.expected_minutes,
             occurrence.d, parent.id
      from public.repeat_occurrence_dates(
             parent.repeat_kind, parent.repeat_weekdays, parent.repeat_monthday,
             greatest(after_anchor, bound_floor - 1), today_local
           ) as occurrence(d)
      where not exists (
        select 1 from public.chore_repeat_exceptions e
        where e.chore_id = parent.id and e.excluded_on = occurrence.d
      )
      on conflict (generated_from, due_on) where generated_from is not null
      do nothing
      returning id
    ),
    copied as (
      insert into public.chore_exclusions (household_id, chore_id, member_id)
      select parent.household_id, made.id, x.member_id
      from made
      join public.chore_exclusions x on x.chore_id = parent.id
      returning 1
    )
    select count(*) into made_now from made;

    select count(*) into skipped_now
    from public.repeat_occurrence_dates(
           parent.repeat_kind, parent.repeat_weekdays, parent.repeat_monthday,
           after_anchor, bound_floor - 1
         ) as occurrence(d)
    where not exists (
      select 1 from public.chore_repeat_exceptions e
      where e.chore_id = parent.id and e.excluded_on = occurrence.d
    );

    update public.chores
       set repeat_caught_up_through = today_local
     where public.chores.id = parent.id
       and (repeat_caught_up_through is null
            or repeat_caught_up_through < today_local);

    created_count := created_count + made_now;
    skipped_count := skipped_count + skipped_now;
  end loop;

  return next;
end;
$$;

-- `create or replace` preserves the ACLs `0012` set on `catch_up_repeats_at`
-- (granted to no client role; the suite's clock-holding entry point), so no
-- privilege statement is re-issued for it here.

-- ---------------------------------------------------------------------------
-- 4. Privileges
-- ---------------------------------------------------------------------------

-- The new column joins the readable, declarable and editable sets, exactly as
-- `repeat_kind` and `repeat_weekdays` sit in all three: the form shows what it
-- set, a repeat is declared where the chore is created (#53), and editing or
-- stopping one is an edit to the chore that holds it (#54). Column additions
-- are additive, so the full-list re-issues in 0012 and elsewhere are
-- untouched. The pass's own bookkeeping columns stay writable by no client —
-- probe:live-grants' negative control is deliberately not named anywhere in
-- this file's statements.
grant select (repeat_monthday) on public.chores to authenticated;
grant insert (repeat_monthday) on public.chores to authenticated;
grant update (repeat_monthday) on public.chores to authenticated;

-- The recreated schedule function gets `0012`'s exact treatment: callable by
-- nobody but the definer functions that inline it. `public, anon` named for
-- 0016's reason — Postgres hands PUBLIC execute on every new function, and the
-- hosted platform additionally names `anon` and `authenticated` by default.
revoke all on function public.repeat_occurrence_dates(text, smallint[], smallint, date, date)
  from public, anon, authenticated;
