-- Skip a single occurrence of a repeating chore — story #105.
--
-- "We're away next week" must not require stopping the repeat and recreating
-- the whole schedule. The mechanism is an EXCEPTION DATE: one row saying this
-- anchor generates nothing on this household-local date. Structured, never free
-- text — the exceptions scope that originally lived in the #10/#11 shape,
-- arriving in #53's shape instead: an exception is a property of the anchor
-- chore, exactly as the schedule itself is.
--
-- NOT to be confused with `chore_exclusions` (0010), which pairs a chore with a
-- PERSON who cannot do it. The two vocabularies deliberately share no table and
-- no function: an exclusion is about who, an exception is about when.
--
-- ===========================================================================
-- The ratified retroactivity rule (owner, 2026-08-16, at the groom gate)
-- ===========================================================================
--
-- A skip requested for a date whose instance has ALREADY generated removes the
-- uncompleted instance and keeps a completed one as history. This is the only
-- option where "we're away next week" actually works after catch-up generation
-- has run — refuse-once-generated guts the main use case whenever catch-up
-- fired first, and future-generation-only is timing-dependent and reads as a
-- bug. It is a stated carve-out to #54's committed-load-never-moves rule:
-- removing an uncompleted generated instance moves that week's committed
-- minutes, and that movement IS the feature. Completed work is never touched.
--
-- That rule is why the skip is a FUNCTION and not a client insert. The
-- exception row and the instance removal are one act — an exception stored
-- without the removal leaves the instance on the list looking unskippable, and
-- a removal without the exception is just a delete. One transaction, and the
-- completed-stays-uncompleted-goes boundary is enforced where no client can
-- reach around it. The table therefore has NO client insert privilege at all:
-- `skip_repeat_occurrence` is the only writer, the same single-writer shape
-- `calendar_tokens` (0011) uses, and stronger than a column list — a whole
-- statement a reader argues with, not a word in one.
--
-- Undoing a skip is deliberately NOT built: no delete privilege, no function.
-- An undone skip whose date the pass has already moved past would regenerate
-- nothing anyway (the watermark owns that), so an honest undo needs its own
-- thinking and its own story if a household ever wants one.
--
-- ===========================================================================
-- What the exception check in the pass is FOR, given the watermark exists
-- ===========================================================================
--
-- `0012`'s watermark already keeps a DELETED occurrence deleted — but it can
-- only protect dates the pass has already decided. An exception stored for an
-- UPCOMING date is a claim about a decision the pass has not made yet, and
-- without the check below the pass would create the instance in the same
-- statement that advances the watermark past it. The check is what makes a
-- stored exception hold for dates the pass reaches later; the unique index
-- `chores_one_occurrence_per_date` still owns exactly-once for everything else,
-- and #53's double-fire proof is untouched.
--
-- A deliberately skipped date is also excluded from `skipped_count`: that
-- number announces occurrences MISSED because nobody opened the app, and a date
-- the household chose to skip is not a missed one — announcing it would tell
-- them about a gap they created on purpose.
--
-- ===========================================================================
-- Re-runnability, and one ordering hazard worth naming
-- ===========================================================================
--
-- Applied by `npm run migrate:live` or a hand paste; a re-paste is the normal
-- path. The table uses `if not exists` with constraints declared INLINE
-- (0003's device: on a re-run the whole `create table` is skipped and the
-- constraints go with it); functions are `create or replace`; the privilege
-- statements are idempotent.
--
-- The hazard: this file REPLACES `catch_up_repeats_at`, so re-pasting `0012`
-- on top of a project that has this file reverts the pass to the
-- exception-blind body — the 0004/0006-after-0007 shape `0007`'s own notes
-- record. The repair is re-pasting THIS file, and the whole-list-in-order
-- re-run stays safe, which is what `migrations.pglite.test.js` proves.

-- ---------------------------------------------------------------------------
-- 1. The exception itself
-- ---------------------------------------------------------------------------

-- One row per (anchor chore, household-local date) that must generate nothing.
-- The ABSENCE of a row is the default: no rows means the schedule runs as
-- written. `due_on` is a calendar date with no zone (0003), and `excluded_on`
-- matches it — the comparison in the pass is date = date in the household's
-- own calendar.
create table if not exists public.chore_repeat_exceptions (
  id           uuid primary key default extensions.gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  chore_id     uuid not null,
  excluded_on  date not null,
  created_at   timestamptz not null default now(),

  -- Skipping a date twice is the same fact: the second row is refused rather
  -- than stored. `skip_repeat_occurrence` treats the conflict as already done
  -- (see its own comment), so this is structural exactly-one, not a user-facing
  -- refusal. Also the index the pass's not-exists probe uses.
  constraint chore_repeat_exceptions_one_per_date unique (chore_id, excluded_on),

  -- Composite, like every cross-row reference since 0005: the exception must
  -- name an anchor IN ITS OWN HOUSEHOLD, so a row pairing one family's chore
  -- with another family's household_id cannot exist at all.
  --
  -- `on delete cascade`, and the CONTRAST with 0012's `on delete set null
  -- (generated_from)` is the point: an occurrence is real work that outlives
  -- its schedule, an exception IS schedule state and dies with it. A household
  -- that deletes a repeat and later recreates one with the same name must not
  -- inherit invisible holes in the new schedule.
  constraint chore_repeat_exceptions_chore_in_household
    foreign key (chore_id, household_id)
    references public.chores (id, household_id) on delete cascade
);

comment on table public.chore_repeat_exceptions is
  'One row per (anchor chore, date) that generates no occurrence. Absence is '
  'the default; written only by skip_repeat_occurrence. Story #105.';

-- No version-bump trigger here, deliberately (0018 adds one to every allocator
-- input table). An exception for an upcoming date changes no allocatable work —
-- the occurrence it suppresses does not exist as a chore yet — and the one
-- immediate state change a skip can make, removing a generated instance, fires
-- `chores_bump_assignments_version` through the chores row itself.

-- ---------------------------------------------------------------------------
-- 2. Row-level security — which ROWS
-- ---------------------------------------------------------------------------

-- Select only: the screen reads which dates are skipped so it can say so and
-- stop offering them. There is no insert or delete policy because there is no
-- client write path at all — the function below is `security definer` and does
-- not consult policies. Same flat household trust boundary as everything else:
-- any member may skip, `docs/access-model.md` ratifies why there is no
-- organizer gate on ordinary schedule maintenance.

alter table public.chore_repeat_exceptions enable row level security;

drop policy if exists chore_repeat_exceptions_select_same_household on public.chore_repeat_exceptions;
create policy chore_repeat_exceptions_select_same_household
  on public.chore_repeat_exceptions for select to authenticated
  using (household_id in (select public.current_household_ids()));

-- ---------------------------------------------------------------------------
-- 3. Column-level privileges — which COLUMNS
-- ---------------------------------------------------------------------------

-- Revoked from `anon` alongside `authenticated` for 0002's reason: no policy
-- above targets anon so it cannot reach a row today, but that is one `to anon`
-- away from being false. On the live project this also clears the permissive
-- creation-time default ACL that `0017` cleared for every table before it.

revoke all on public.chore_repeat_exceptions from authenticated, anon;

-- `household_id` is absent, matching 0010: written by the function, never read
-- back — RLS already guarantees every visible row belongs to the caller's
-- household — and withholding it is what keeps a wildcard select failing
-- LOUDLY on this table rather than quietly returning whatever exists.
grant select (id, chore_id, excluded_on, created_at)
  on public.chore_repeat_exceptions to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The skip, as one transaction
-- ---------------------------------------------------------------------------

-- `security definer` for BOTH of the house's reasons at once: access (no
-- client privilege can write the exception or should be trusted to apply the
-- completed-stays rule) and scope (`current_household_ids()`, the same
-- predicate every policy uses).
--
-- `for update` on the anchor row serialises against the catch-up pass, which
-- locks the same row (`for update of c` in `catch_up_repeats_at`): a skip
-- arriving while a pass is mid-generation waits, then removes whatever the
-- pass just created for that date; a pass arriving after the skip sees the
-- exception. Neither order can leave a skipped date's instance standing.
--
-- THE ARGUMENT NAMES SHADOW COLUMN NAMES (`chore_id` is a column of
-- `chore_repeat_exceptions`), so every reference is qualified with the
-- function's own name — 0010's rule. plpgsql's default #variable_conflict
-- would raise on the ambiguity rather than silently misresolve, and the
-- qualified spelling never asks it to.
--
-- Returns the number of instance rows removed (0 or 1). The client does not
-- need it — every mutation is followed by a full refresh — but a caller
-- proving the retroactivity rule can read it directly.
create or replace function public.skip_repeat_occurrence(chore_id uuid, skip_date date)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  anchor record;
  removed integer;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  if skip_repeat_occurrence.skip_date is null then
    raise exception 'Which date should be skipped?';
  end if;

  select c.id, c.household_id, c.repeat_kind
    into anchor
    from public.chores c
   where c.id = skip_repeat_occurrence.chore_id
     and c.household_id in (select public.current_household_ids())
     for update;

  if not found then
    raise exception 'No such chore in this household.';
  end if;
  if anchor.repeat_kind = 'none' then
    raise exception 'This chore does not repeat, so there is no occurrence to skip.';
  end if;

  -- `do nothing` rather than refusing: a second device skipping the same date
  -- is stating the same fact, and the goal state — this date generates nothing
  -- — already holds. The delete below still runs, so a race where the pass
  -- generated the instance between the two skips is still cleaned up.
  --
  -- The conflict target is the CONSTRAINT'S NAME, not its column list, and
  -- that is load-bearing rather than style: plpgsql parses a column-list
  -- conflict target as expressions, so a bare `chore_id` there is ambiguous
  -- against this function's own parameter and the insert refuses to compile.
  -- Measured on the first run of this function's suite.
  insert into public.chore_repeat_exceptions (household_id, chore_id, excluded_on)
  values (anchor.household_id, anchor.id, skip_repeat_occurrence.skip_date)
  on conflict on constraint chore_repeat_exceptions_one_per_date do nothing;

  -- The retroactivity rule, in one predicate: uncompleted goes, completed
  -- stays. `generated_from` scopes this to instances the pass created — the
  -- anchor row itself is the schedule and is never removed by a skip.
  delete from public.chores o
   where o.generated_from = anchor.id
     and o.due_on = skip_repeat_occurrence.skip_date
     and o.completed_at is null;
  get diagnostics removed = row_count;

  return removed;
end;
$$;

comment on function public.skip_repeat_occurrence(uuid, date) is
  'Store an exception date for a repeating chore and remove that date''s '
  'uncompleted generated instance if one exists; a completed one stays as '
  'history. The only writer of chore_repeat_exceptions. Story #105.';

-- ---------------------------------------------------------------------------
-- 5. The catch-up pass learns to honour exceptions
-- ---------------------------------------------------------------------------

-- `0012`'s body with two additions, both `not exists` probes against the
-- exception table: one in the insert (an excepted date generates no instance —
-- #105 AC 2/AC 3) and one in the skipped count (a deliberate skip is not a
-- missed occurrence to announce). Everything else is byte-for-byte 0012, and
-- the comments explaining the shape stay with that file.
create or replace function public.catch_up_repeats_at(as_of timestamptz)
returns table (created_count integer, skipped_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
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
    today_local := (as_of at time zone parent.timezone)::date;

    after_anchor := greatest(
      parent.due_on,
      parent.repeat_since,
      coalesce(parent.repeat_caught_up_through, parent.repeat_since)
    );

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
      -- #105: a stored exception means this date generates nothing, however
      -- many times the pass runs past it.
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
           parent.repeat_kind, parent.repeat_weekdays,
           after_anchor, bound_floor - 1
         ) as occurrence(d)
    -- #105: a date the household skipped on purpose is not a missed occurrence.
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
-- 6. Function privileges
-- ---------------------------------------------------------------------------

-- `public, anon` named for 0016's reason: Postgres hands PUBLIC execute on
-- every new function, and the hosted platform additionally names `anon` — a
-- revoke that only says `public` leaves the by-name entry standing.
revoke all on function public.skip_repeat_occurrence(uuid, date) from public, anon;
grant execute on function public.skip_repeat_occurrence(uuid, date) to authenticated;
