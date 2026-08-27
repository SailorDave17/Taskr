-- Stored re-assignment — story #49.
--
-- The charter's grooming decision log (2026-08-06) settled the shape this file
-- implements: allocation is STORED, with an automatic re-derive on capacity
-- change — not derived-at-read, and not a button. The allocator itself stays
-- exactly where it is, in src/lib/allocation.js, and nothing in this file
-- re-implements a placement rule: the wiring adds persistence, never logic
-- (#49 AC 1). What this file adds is the three things persistence needs and
-- JavaScript cannot provide — a column that remembers HOW a chore was assigned,
-- a version that says whether a computed result is still about the current
-- household, and one transactional apply path.
--
-- ===========================================================================
-- Why the server does not run the allocator
-- ===========================================================================
--
-- The allocation rule has exactly one implementation (#40 AC 9 permits one
-- `fairShare` and one `isLevel`; `allocate` and `reallocate` are one function).
-- A plpgsql copy would be a second implementation, and the two would drift the
-- first time either changed — the drift this schema's own comments warn about
-- for `members.committed_minutes`. So the client that observed the capacity
-- change computes the new allocation with the real module and hands the RESULT
-- here. What the server owns is what only the server can own: that the result
-- is applied atomically, that it was computed from the state it is replacing,
-- and that a manual placement survives it.
--
-- The trust envelope does not move. A signed-in member's client can already
-- place any chore on any member via `assign_chore`; a client that lies to
-- `apply_assignments` can mis-assign chores in its own household, which is
-- exactly what it could do before, one call at a time. The composite FK still
-- refuses any member outside the household.
--
-- ===========================================================================
-- MANUAL versus AUTO, and why the column is needed at all
-- ===========================================================================
--
-- Until now every `assigned_member_id` was written by a person tapping a name —
-- a manual placement, which the allocator must never move (#40 AC 8). Once the
-- re-assignment RPC stores its own results in the same column, the column stops
-- saying how the value got there, and the allocator's contract needs exactly
-- that distinction: a manual chore is PINNED (never moved, minutes counted), an
-- auto chore is the INCUMBENT (kept on ties, moved only through the change
-- budget).
--
-- `assigned_source` is meaningful only when `assigned_member_id` is not null.
-- There is deliberately NO check constraint pairing the two nulls: the
-- composite FK's `on delete set null (assigned_member_id)` clears the member
-- and cannot clear the source (a set-null column list may only name FK
-- columns), so a paired-null constraint would make removing a member fail.
-- A dangling source under a null member means "unassigned", every reader
-- treats it so, and the next assignment overwrites it.
--
-- ===========================================================================
-- The version, and the race it exists to end (#49 AC 6)
-- ===========================================================================
--
-- Two devices change capacity within the same second. Each computes a
-- re-assignment from what it read; one of those reads is missing the other's
-- write. Applying both blindly would leave the stored allocation computed from
-- a household state that never existed, with no artefact disagreeing.
--
-- `households.assignments_version` is a compare-and-set token, not a meaning:
-- every write to any table the allocator reads (chores, members,
-- member_capacity, chore_exclusions) bumps it through one trigger function, and
-- `apply_assignments` refuses when the version it is handed is not the version
-- it locks. The refused device re-reads — seeing BOTH writes — recomputes, and
-- re-applies. Convergence is then a property of the allocator being
-- deterministic, not of timing: the last successful apply was computed from the
-- state it replaced.
--
-- The lock ordering makes it airtight rather than probabilistic: every input
-- write's trigger UPDATEs the household row, and `apply_assignments` holds that
-- row's lock from version check to commit — so an input write cannot land
-- between the check and the apply; it blocks, then bumps, and the next apply
-- sees it.
--
-- The client reads the version FIRST, before any other read, and that ordering
-- is load-bearing in the safe direction: a write landing between the version
-- read and the input reads makes the apply refuse a computation that was in
-- fact fresh (one wasted retry), where the reverse order would ACCEPT a
-- computation that was in fact stale.
--
-- A `households` self-trigger is deliberately absent: a timezone change also
-- shifts which overrides apply, but a trigger on the table the trigger updates
-- is recursion bought for a case the next capacity write corrects anyway.
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- Applied by a human pasting into the SQL editor, so a re-paste is the normal
-- path. Columns use `add column if not exists`, constraints go through the
-- pg_constraint lookup, triggers are dropped and re-created, functions are
-- `create or replace` with unchanged signatures where they exist already. The
-- backfill reads only a column that predates this file, so a second paste
-- matches no rows.

-- ---------------------------------------------------------------------------
-- How a chore came to be assigned
-- ---------------------------------------------------------------------------

alter table public.chores
  add column if not exists assigned_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chores_assigned_source_known'
  ) then
    alter table public.chores
      add constraint chores_assigned_source_known
      check (assigned_source is null or assigned_source in ('manual', 'auto'));
  end if;
end
$$;

-- Every assignment that exists today was made by a person through
-- `assign_chore` — the RPC was the only write path — so the backfill is a fact,
-- not a default. It reads only `assigned_member_id`, which predates this file,
-- so it acts on real data at paste time (unlike a backfill reading a column
-- added above it, which would be a no-op by construction).
update public.chores
   set assigned_source = 'manual'
 where assigned_member_id is not null
   and assigned_source is null;

-- ---------------------------------------------------------------------------
-- The version every allocator input bumps
-- ---------------------------------------------------------------------------

alter table public.households
  add column if not exists assignments_version bigint not null default 0;

-- The last re-balance's own verdict — #49 AC 7. `level`, `reason`,
-- `boundByBudget` and the churn figures are facts about the RUN, not about the
-- current rows: whether the change budget bound the result cannot be recomputed
-- from the stored assignments, so a surface that wants to state the reason must
-- read the verdict the run recorded rather than derive a different one and
-- disagree. Written only by `apply_assignments` below.
alter table public.households
  add column if not exists last_rebalance jsonb;

-- One trigger function for every input table. Security definer because the
-- writer is an `authenticated` client with no update grant on `households` —
-- the bump is bookkeeping the schema owns, not a privilege the client holds.
create or replace function public.note_split_inputs_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.households
     set assignments_version = assignments_version + 1
   where id = coalesce(new.household_id, old.household_id);
  return null;
end;
$$;

-- Row-level and unconditional: several bumps per statement are fine, because
-- only equality with a previously-read value ever matters. The cost is that
-- concurrent writers in one household serialize on the household row for the
-- duration of a statement, which at household scale is the point rather than a
-- problem.
drop trigger if exists chores_bump_assignments_version on public.chores;
create trigger chores_bump_assignments_version
  after insert or update or delete on public.chores
  for each row execute function public.note_split_inputs_changed();

drop trigger if exists members_bump_assignments_version on public.members;
create trigger members_bump_assignments_version
  after insert or update or delete on public.members
  for each row execute function public.note_split_inputs_changed();

drop trigger if exists member_capacity_bump_assignments_version on public.member_capacity;
create trigger member_capacity_bump_assignments_version
  after insert or update or delete on public.member_capacity
  for each row execute function public.note_split_inputs_changed();

drop trigger if exists chore_exclusions_bump_assignments_version on public.chore_exclusions;
create trigger chore_exclusions_bump_assignments_version
  after insert or update or delete on public.chore_exclusions
  for each row execute function public.note_split_inputs_changed();

-- ---------------------------------------------------------------------------
-- The transactional apply — the RPC the grooming decision costed
-- ---------------------------------------------------------------------------

-- `placements` is a jsonb array of {"chore_id": uuid, "member_id": uuid|null} —
-- the allocator's answer for every open, non-manual chore, null meaning nobody
-- is eligible and the chore stays in the flagged unassigned state (#49 AC 5).
--
-- STRICT on purpose: a placement that does not match exactly one open,
-- non-manual chore in this household raises and the whole apply rolls back.
-- Under the version CAS a mismatch cannot be an ordinary race — the version
-- would have moved — so it is a caller bug, and a partial apply would break
-- AC 1's identity between the stored result and the allocator's answer.
--
-- A member outside the household is refused by the composite FK
-- (`chores_assigned_member_in_household`) in Postgres's words rather than ours;
-- the caller here is our own wiring, not a form a person filled in, so the
-- sentence-first convention of `assign_chore` buys nothing.
--
-- Errcode TA049 on the version refusal so the client can retry on the CODE
-- rather than matching a message. A five-character class of our own, not
-- `40001`, so nothing between Postgres and the app treats it as a transient
-- serialization failure to be retried with the SAME (already stale) arguments.
create or replace function public.apply_assignments(
  household_id uuid,
  expected_version bigint,
  placements jsonb,
  verdict jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  current_version bigint;
  entry jsonb;
  target_chore uuid;
  target_member uuid;
  applied integer := 0;
  matched integer;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  if jsonb_typeof(placements) is distinct from 'array' then
    raise exception 'placements must be an array of {chore_id, member_id}';
  end if;
  if jsonb_typeof(verdict) is distinct from 'object' then
    raise exception 'verdict must be the re-balance verdict object';
  end if;

  if not exists (
    select 1 from public.members m
    where m.household_id = apply_assignments.household_id
      and m.claimed_by = caller
  ) then
    raise exception 'no such household for this member';
  end if;

  -- The lock is held from here to commit; see the header. Every concurrent
  -- input write blocks on this row inside its bump trigger, so nothing can
  -- change the allocator's inputs between this check and the updates below.
  select h.assignments_version into current_version
  from public.households h
  where h.id = apply_assignments.household_id
  for update;

  if current_version is distinct from expected_version then
    raise exception 'the household changed while re-assignment was computed'
      using errcode = 'TA049';
  end if;

  for entry in select value from jsonb_array_elements(placements)
  loop
    target_chore := (entry ->> 'chore_id')::uuid;
    target_member := (entry ->> 'member_id')::uuid;

    update public.chores c
       set assigned_member_id = target_member,
           assigned_source = case when target_member is null then null else 'auto' end
     where c.id = target_chore
       and c.household_id = apply_assignments.household_id
       and c.completed_at is null
       and not (c.assigned_source = 'manual' and c.assigned_member_id is not null);

    get diagnostics matched = row_count;
    if matched <> 1 then
      raise exception 'placement % does not name an open, non-manual chore in this household',
        target_chore;
    end if;
    applied := applied + 1;
  end loop;

  update public.households h
     set last_rebalance = verdict || jsonb_build_object('applied_at', now())
   where h.id = apply_assignments.household_id;

  select h.assignments_version into current_version
  from public.households h
  where h.id = apply_assignments.household_id;

  return jsonb_build_object('applied', applied, 'assignments_version', current_version);
end;
$$;

-- ---------------------------------------------------------------------------
-- assign_chore / unassign_chore now say HOW — same signatures, one-line change
-- ---------------------------------------------------------------------------

-- Copied from 0007 (the latest versions — 0006's originals resolved membership
-- through the dropped `household_devices`), with `assigned_source` written
-- beside the member. Signatures unchanged, so `create or replace` replaces
-- rather than overloads.

create or replace function public.assign_chore(chore_id uuid, member_id uuid)
returns public.chores
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.chores;
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  if member_id is null then
    raise exception 'assign_chore needs a person; use unassign_chore to clear it';
  end if;

  select c.* into target
  from public.chores c
  where c.id = chore_id
    and c.household_id in (select public.current_household_ids())
  for update of c;

  if not found then
    raise exception 'no such chore in your household';
  end if;

  if not exists (
    select 1 from public.members m
    where m.id = member_id and m.household_id = target.household_id
  ) then
    raise exception 'that person is not in this household';
  end if;

  update public.chores
     set assigned_member_id = member_id,
         assigned_source = 'manual'
   where id = chore_id
  returning * into target;

  return target;
end;
$$;

create or replace function public.unassign_chore(chore_id uuid)
returns public.chores
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.chores;
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  select c.* into target
  from public.chores c
  where c.id = chore_id
    and c.household_id in (select public.current_household_ids())
  for update of c;

  if not found then
    raise exception 'no such chore in your household';
  end if;

  update public.chores
     set assigned_member_id = null,
         assigned_source = null
   where id = chore_id
  returning * into target;

  return target;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- The chores select grant, re-issued in full with the new column — one
-- statement a reader can check against CHORE_COLUMNS in src/lib/chores.js in
-- one glance, the same convention as 0006 and 0015. `assigned_source` is
-- READABLE and not WRITABLE: like `assigned_member_id` it moves only through
-- the functions above, or every allocator invariant becomes advisory.
grant select (id, household_id, title, expected_minutes, due_on, created_at,
              completed_at, completed_by_member_id, assigned_member_id,
              repeat_kind, repeat_weekdays, generated_from, actual_minutes,
              assigned_source)
  on public.chores to authenticated;

-- The two new household columns, additively — household.js reads `*`, which
-- works precisely because every column is granted (0013's convention).
grant select (assignments_version, last_rebalance)
  on public.households to authenticated;

revoke all on function public.note_split_inputs_changed() from public, anon, authenticated;

revoke all on function public.apply_assignments(uuid, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.apply_assignments(uuid, bigint, jsonb, jsonb) to authenticated;
