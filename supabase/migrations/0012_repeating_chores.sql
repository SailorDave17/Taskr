-- A chore that comes back on its own schedule — story #53.
--
-- SUPERSEDES the #10/#11 shape on the evidence recorded there: no templates
-- screen and no template table. A repeat is a PROPERTY OF A CHORE — the row a
-- household already maintains — and the instantiation mechanism is client-
-- triggered catch-up, because pg_cron on the free plan stops silently when the
-- project pauses after a week idle. There is no schedule trigger separate from
-- opening the app: the catch-up pass IS the mechanism, so this file ships both
-- halves together.
--
-- ===========================================================================
-- The shape: parent chore as schedule, occurrences as ordinary chores
-- ===========================================================================
--
-- The chore a household marks as repeating is the ANCHOR: its own `due_on` is
-- the first occurrence, and every later occurrence is a NEW ROW in `chores`
-- carrying `generated_from = parent.id`. An occurrence is unassigned work like
-- any other chore (#53 AC 7): completion, assignment, exclusion warnings and
-- the load figures all pick it up with no special case, because there is no
-- special case to have — it is a chore.
--
-- Occurrences copy the parent's `expected_minutes` and its exclusion rows AT
-- CREATION (#53 AC 1). They deliberately do not FOLLOW the parent afterwards:
-- edit propagation is #54's story, and its rule (already-dated occurrences keep
-- their values) is exactly what copy-at-creation produces for free.
--
-- `chores_occurrence_does_not_repeat` below forbids a generated occurrence from
-- itself repeating. Without it one bad write turns the catch-up pass into a
-- generator of generators.
--
-- ===========================================================================
-- Exactly-once is the INDEX, not the code (#53 AC 2)
-- ===========================================================================
--
-- Two devices opening the app in the same second both compute the same missed
-- occurrences and both insert. The thing that makes that safe is
-- `chores_one_occurrence_per_date` — a partial unique index on
-- (generated_from, due_on) — plus `on conflict do nothing` in the pass. The
-- watermark below also stops the second run recomputing, but that is politeness
-- and bookkeeping: delete every watermark and the index still holds the
-- invariant. The test suite proves the index alone refuses a duplicate.
--
-- `due_on` IS the household-local date — 0003 made it a calendar date with no
-- zone on purpose — so "chore plus household-local date" needs no extra column.
--
-- ===========================================================================
-- The catch-up bound (#53 AC 4)
-- ===========================================================================
--
-- CATCH_UP_BOUND_DAYS = 7 — owner decision 2026-08-24, recorded in
-- docs/refresh-charter.md's decision log. A household that opens the app after
-- a gap gets at most the last seven days of occurrences; anything older is
-- COUNTED and reported by the pass so the app can say it was skipped, rather
-- than dumping a fortnight of stale chores on someone who just walked in — the
-- shame-and-nagging failure the design direction rules out. The constant lives
-- in `catch_up_repeats_at` below; `src/lib/chores.js` carries the same value
-- for the sentence the UI shows, and a test asserts the two copies agree.
--
-- ===========================================================================
-- The watermark: `repeat_caught_up_through`
-- ===========================================================================
--
-- The pass advances it to the household-local "today" it ran for, and never
-- backward. Three things rest on it, none of them exactly-once (the index owns
-- that):
--   1. A skipped-occurrences gap is ANNOUNCED once, not on every open forever —
--      skips are recomputable from nothing, so without a high-water mark every
--      later pass would re-report a gap the household was already told about.
--   2. A deleted occurrence STAYS deleted: the index only refuses duplicates of
--      rows that exist, so without the watermark, removing a generated chore
--      inside the bound window would resurrect it on the next open. (Proper
--      exception dates — "skip next Tuesday" — are #105, a named follow-up.)
--   3. The pass does not rescan the whole history on every open.
--
-- ===========================================================================
-- Why `catch_up_repeats` is SECURITY DEFINER, and why it is split in two
-- ===========================================================================
--
-- Definer for the same reason as `assign_chore`: `generated_from` is absent
-- from the client's insert grant — a client that could write it could forge
-- occurrence rows against any parent and poison the exactly-once key — so the
-- only path that writes it is this function. Scope comes from
-- `current_household_ids()`, the same predicate every policy uses.
--
-- The split: `catch_up_repeats_at(as_of)` takes the instant as a parameter and
-- is granted to NO client role — it exists so the suite can hold the clock
-- (23:30 on a Sunday, a DST boundary) instead of trusting whatever moment the
-- test ran at. `catch_up_repeats()` is the client surface and does nothing but
-- pass `now()` — the DATABASE's clock, 0004's argument: a phone with the wrong
-- date cannot move occurrences between days, because the client supplies no
-- timestamp and cannot.
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- Applied by a human pasting into the Supabase SQL editor, so a re-paste after
-- a partial failure is the normal path. Columns use `add column if not
-- exists`; named constraints go through the `pg_constraint` lookup (0005's and
-- 0010's device, because `alter table add constraint` has no idempotent form);
-- the index uses `if not exists`; functions are `create or replace`; the
-- trigger is dropped and recreated.

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------

-- Structured, never free text (#53 AC 6): a kind, and for weekly a set of ISO
-- weekdays (1 = Monday .. 7 = Sunday, Postgres's own `isodow`). Monthly
-- schedules and exception dates are #103 and #105, named follow-ups rather
-- than silent inclusions — 'monthly' is refused here by the check constraint.
alter table public.chores
  add column if not exists repeat_kind text not null default 'none';

alter table public.chores
  add column if not exists repeat_weekdays smallint[];

-- The household-local date the repeat was switched on, set by the trigger
-- below and writable by no client. #53 AC 3: no occurrence may be created for
-- a date before this.
alter table public.chores
  add column if not exists repeat_since date;

alter table public.chores
  add column if not exists repeat_caught_up_through date;

alter table public.chores
  add column if not exists generated_from uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chores_repeat_kind_known') then
    alter table public.chores add constraint chores_repeat_kind_known
      check (repeat_kind in ('none', 'daily', 'weekly'));
  end if;

  -- Weekdays travel with 'weekly' and only with it. The `coalesce` matters:
  -- `array_length` of an EMPTY array is null, a null CHECK passes, and a
  -- weekly repeat with no weekdays would be a chore that never comes back
  -- while looking exactly like one that does.
  if not exists (select 1 from pg_constraint where conname = 'chores_repeat_weekdays_shape') then
    alter table public.chores add constraint chores_repeat_weekdays_shape
      check (
        (repeat_kind = 'weekly') = (repeat_weekdays is not null)
        and (
          repeat_weekdays is null
          or (
            coalesce(array_length(repeat_weekdays, 1), 0) >= 1
            and repeat_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
          )
        )
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chores_repeat_since_present') then
    alter table public.chores add constraint chores_repeat_since_present
      check ((repeat_kind = 'none') = (repeat_since is null));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chores_occurrence_does_not_repeat') then
    alter table public.chores add constraint chores_occurrence_does_not_repeat
      check (generated_from is null or repeat_kind = 'none');
  end if;

  -- Composite, like every cross-row reference since 0005: an occurrence must
  -- name a parent IN ITS OWN HOUSEHOLD, so a row pairing one family's parent
  -- with another family's household_id cannot exist at all. `on delete set
  -- null (generated_from)` — the column list is the point: a bare SET NULL on
  -- a composite key would null household_id too. Deleting a repeating chore
  -- ends the schedule and ORPHANS the occurrences rather than destroying
  -- them — they are real work, some of it completed history, which is #54's
  -- stated rule arriving early.
  if not exists (select 1 from pg_constraint where conname = 'chores_generated_from_in_household') then
    alter table public.chores add constraint chores_generated_from_in_household
      foreign key (generated_from, household_id)
      references public.chores (id, household_id)
      on delete set null (generated_from);
  end if;
end
$$;

comment on column public.chores.repeat_kind is
  'none, daily, or weekly. A repeat is a property of the chore — there is no '
  'template object and no templates screen. Story #53; monthly is #103.';

comment on column public.chores.repeat_since is
  'Household-local date the repeat was switched on, set by trigger. The '
  'catch-up pass creates nothing dated at or before this. Story #53.';

comment on column public.chores.repeat_caught_up_through is
  'High-water mark of the catch-up pass: the household-local date it last ran '
  'for. Bookkeeping, not the exactly-once rule — that is the partial unique '
  'index chores_one_occurrence_per_date. Story #53.';

comment on column public.chores.generated_from is
  'The repeating chore this occurrence was generated from, null for a chore a '
  'person typed. Set only by catch_up_repeats — absent from every client '
  'grant. Story #53.';

-- The exactly-once rule (#53 AC 2). Partial, because hand-typed chores have no
-- parent and two of them on one date is an ordinary Tuesday.
create unique index if not exists chores_one_occurrence_per_date
  on public.chores (generated_from, due_on)
  where generated_from is not null;

-- ---------------------------------------------------------------------------
-- 2. `repeat_since` is the DATABASE's date, not the phone's
-- ---------------------------------------------------------------------------

-- Definer for the same reason `assert_valid_timezone` reads nothing from the
-- caller: the household's timezone decides which calendar date "today" is, and
-- the row being written already names the household. A client cannot write
-- `repeat_since` at all (no grant), so this trigger is the only author.
create or replace function public.set_repeat_since()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  household_tz text;
begin
  if new.repeat_kind = 'none' then
    new.repeat_since := null;
    return new;
  end if;
  if new.repeat_since is null then
    select h.timezone into household_tz
    from public.households h
    where h.id = new.household_id;
    new.repeat_since := (now() at time zone coalesce(household_tz, 'UTC'))::date;
  end if;
  return new;
end;
$$;

drop trigger if exists chores_repeat_since on public.chores;
create trigger chores_repeat_since
  before insert or update of repeat_kind on public.chores
  for each row execute function public.set_repeat_since();

-- ---------------------------------------------------------------------------
-- 3. The schedule, as a pure function of dates
-- ---------------------------------------------------------------------------

-- Every date strictly after `start_after`, up to and including `until`, that
-- the schedule matches. No table access and no clock — the callers own both —
-- which is what makes the schedule arithmetic testable against fixed dates.
-- `language sql` and immutable so the planner may inline it.
create or replace function public.repeat_occurrence_dates(
  kind text, weekdays smallint[], start_after date, until date
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
     or (kind = 'weekly' and extract(isodow from d)::smallint = any (weekdays));
$$;

comment on function public.repeat_occurrence_dates(text, smallint[], date, date) is
  'Schedule dates in (start_after, until]. Pure calendar arithmetic: no clock, '
  'no tables, no zone — the caller resolves all three. Story #53.';

-- ---------------------------------------------------------------------------
-- 4. The catch-up pass
-- ---------------------------------------------------------------------------

create or replace function public.catch_up_repeats_at(as_of timestamptz)
returns table (created_count integer, skipped_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Owner decision 2026-08-24, decision log in docs/refresh-charter.md. The
  -- UI's copy of this number lives in src/lib/chores.js and a test holds the
  -- two equal.
  catch_up_bound_days constant integer := 7;

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

  -- `for update of c` serialises two devices racing on the same parent: the
  -- second waits, then sees the moved watermark and re-reports nothing. It is
  -- NOT the exactly-once rule — drop it and the unique index still refuses
  -- the duplicate rows; what it deduplicates is the announcement.
  for parent in
    select c.id, c.household_id, c.title, c.expected_minutes, c.due_on,
           c.repeat_kind, c.repeat_weekdays, c.repeat_since,
           c.repeat_caught_up_through, h.timezone
    from public.chores c
    join public.households h on h.id = c.household_id
    where c.repeat_kind <> 'none'
      and c.household_id in (select public.current_household_ids())
    order by c.created_at, c.id
    for update of c
  loop
    -- The household's own calendar decides which date "now" is. At 23:30 on
    -- Sunday in the household's zone, Monday's occurrence does not exist yet,
    -- whatever UTC or the server's zone says.
    today_local := (as_of at time zone parent.timezone)::date;

    -- Nothing dated at or before: the repeat being switched on (#53 AC 3),
    -- the parent's own due date (the parent IS that occurrence), or the last
    -- date already caught up for (which is what keeps a deleted occurrence
    -- deleted).
    after_anchor := greatest(
      parent.due_on,
      parent.repeat_since,
      coalesce(parent.repeat_caught_up_through, parent.repeat_since)
    );

    -- The oldest date this pass may CREATE; everything older is skipped.
    bound_floor := today_local - catch_up_bound_days + 1;

    with made as (
      insert into public.chores
        (household_id, title, expected_minutes, due_on, generated_from)
      select parent.household_id, parent.title, parent.expected_minutes,
             occurrence.d, parent.id
      from public.repeat_occurrence_dates(
             parent.repeat_kind, parent.repeat_weekdays,
             greatest(after_anchor, bound_floor - 1), today_local
           ) as occurrence(d)
      on conflict (generated_from, due_on) where generated_from is not null
      do nothing
      returning id
    ),
    -- #53 AC 1: an occurrence carries the parent's exclusions. Copied at
    -- creation, for rows THIS statement made — `on conflict do nothing` rows
    -- return nothing, so a lost race copies nothing twice.
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
           parent.repeat_kind, parent.repeat_weekdays,
           after_anchor, bound_floor - 1
         );

    -- Never backward: a timezone change can move today_local behind the
    -- watermark, and a watermark that retreats re-announces a gap.
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

comment on function public.catch_up_repeats_at(timestamptz) is
  'The catch-up pass at a stated instant. Granted to no client role: it exists '
  'so the suite can hold the clock. Clients get catch_up_repeats(). Story #53.';

-- The client surface. All it adds is the clock, and that is the point: now()
-- is the DATABASE's, so a phone with the wrong date cannot move an occurrence
-- between days — 0004's argument, one story later.
create or replace function public.catch_up_repeats()
returns table (created_count integer, skipped_count integer)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from public.catch_up_repeats_at(now());
$$;

comment on function public.catch_up_repeats() is
  'Create every missed occurrence of this household''s repeating chores, up to '
  'the catch-up bound, and say how many older ones were skipped. Called on app '
  'open; safe to call any time. Story #53.';

-- ---------------------------------------------------------------------------
-- 5. Privileges
-- ---------------------------------------------------------------------------

-- The additive-by-column convention from 0003, re-issued in full so one
-- statement lists every readable column (0004's argument). New and readable:
-- `repeat_kind` and `repeat_weekdays` (the form shows what it set) and
-- `generated_from` (the screen may say a chore came from a repeat). Withheld:
-- `repeat_since` and `repeat_caught_up_through` are the pass's own
-- bookkeeping — nothing renders them, and #54 can grant what it needs.
grant select (id, title, expected_minutes, due_on, created_at,
              completed_at, completed_by_member_id, assigned_member_id,
              repeat_kind, repeat_weekdays, generated_from)
  on public.chores to authenticated;

-- A client may DECLARE a repeat where the chore is created (#53 AC 1). It may
-- not write `generated_from` (that would forge the exactly-once key),
-- `repeat_since` (the trigger's), or the watermark (the pass's).
grant insert (household_id, title, expected_minutes, due_on,
              repeat_kind, repeat_weekdays)
  on public.chores to authenticated;

-- The UPDATE grant is deliberately NOT extended: editing or stopping a repeat
-- is #54, and it arrives with rules about what an edit must not touch. Until
-- then a repeat is set at creation, which is all #53 asks.

revoke all on function public.set_repeat_since() from public, anon, authenticated;
revoke all on function public.repeat_occurrence_dates(text, smallint[], date, date)
  from public, anon, authenticated;
revoke all on function public.catch_up_repeats_at(timestamptz)
  from public, anon, authenticated;
revoke all on function public.catch_up_repeats() from public, anon;
grant execute on function public.catch_up_repeats() to authenticated;
