-- Giving a chore to a person — story #36.
--
-- This is where the product's actual claim first becomes checkable. Until now a
-- chore was a quantity of time belonging to a household; from here it belongs to
-- a PERSON, and "how much is this person carrying" stops being a feeling and
-- becomes minutes anyone can add up. #34 made the unit, #35 made "outstanding"
-- real, and this makes the unit attributable.
--
-- ===========================================================================
-- Derived, not stored — and the distinction this file exists to hold
-- ===========================================================================
--
-- What is STORED here is the ALLOCATION: which chore belongs to which person,
-- one column. What is DERIVED is COMMITTED and REMAINING MINUTES, summed at
-- read time in src/lib/chores.js over that member's outstanding chores.
--
-- Both halves are deliberate and they are easy to conflate. A
-- `members.committed_minutes` counter would look like the same decision and be
-- the opposite one: two sources for one quantity, drifting the first time a
-- chore is completed on another phone. #36 AC 5 asserts the ABSENCE of any such
-- column in `information_schema`, not merely the presence of the sum — because
-- the failure mode is an extra column somebody adds later for speed, and a test
-- that only checks the sum stays green through it.
--
-- ===========================================================================
-- Why `assigned_member_id` is server-only when nothing yet depends on it
-- ===========================================================================
--
-- Measured on this repo against the live project, 2026-08-06, before 0002:
--
--   claim_member RPC as device B      -> REFUSED: already claimed on another device
--   UPDATE members SET claimed_by = B -> ALLOWED, 1 row changed, identity taken
--
-- A client-writable `assigned_member_id` is the identical hole with a larger
-- blast radius. The eligibility rule (#37), the churn bound (#41) and every
-- allocator invariant (#40, #49) are enforceable only while the column moves
-- through one path — a client that can write it directly makes all of them
-- advisory. Fifteen lines now against a migration plus a rewrite of a shipped
-- write path later.
--
-- So this migration adds a column and NO update grant for it, exactly as 0004
-- did for `completed_at`. 0003's convention, third time: each migration grants
-- update only on the columns IT makes client-editable, the grant set is
-- additive by column, and the "a client cannot write this" test lives in the
-- story that introduces the withheld column. That test is in this story.
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- Applied by a human pasting into the Supabase SQL editor, so a re-paste after a
-- partial failure is the normal path rather than an edge case. The column uses
-- `add column if not exists`, the index `if not exists`, the functions
-- `create or replace`, and the constraint goes through the `pg_constraint`
-- lookup 0005 uses — `alter table add constraint` has no idempotent form.

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------

-- Who is carrying this chore. A MEMBER row, not an auth id, for the reason 0001
-- gives and 0004 repeats: an anonymous session expires after 30 days idle and
-- returns with a new auth id, so an allocation keyed to `auth.uid()` would
-- detach a rarely-active member from their own work.
--
-- Null means unassigned, which is the starting state of every chore and a
-- legitimate resting state — a household that writes the week down before
-- dividing it is doing the normal thing.
alter table public.chores
  add column if not exists assigned_member_id uuid;

-- The reference is COMPOSITE — (assigned_member_id, household_id) against
-- members (id, household_id) — rather than the single-column form
-- `completed_by_member_id` uses, and the difference is the point of
-- docs/access-model.md.
--
-- A single-column FK would let a chore in household A name a member of
-- household B: the value would be a real `members.id`, so the constraint would
-- be satisfied, and only `assign_chore` below would stand between that state and
-- the database. This file's whole argument is that a rule living only inside a
-- function is a rule for clients that choose to call it. The function still
-- refuses first, because AC 1 wants a SENTENCE rather than a constraint
-- violation — but the constraint is what keeps the refusal true if the function
-- is later edited wrongly.
--
-- `on delete set null (assigned_member_id)` names its column, and that clause is
-- load-bearing: a bare `on delete set null` on a composite key nulls EVERY
-- referencing column, and `household_id` is `not null`, so removing a member
-- would fail with a constraint violation instead of unassigning the chore —
-- turning AC 7 into its exact opposite. The column list is Postgres 15+, which
-- both PGlite 18 here and Supabase satisfy.
--
-- `members_id_household_key` — the unique constraint this references — was added
-- by 0005, for the same reason, on `member_capacity`.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chores_assigned_member_in_household'
  ) then
    alter table public.chores
      add constraint chores_assigned_member_in_household
      foreign key (assigned_member_id, household_id)
      references public.members (id, household_id)
      on delete set null (assigned_member_id);
  end if;
end
$$;

-- "What is this person still carrying" is the query every figure on the load
-- screen is built from.
create index if not exists chores_assigned_outstanding_idx
  on public.chores (household_id, assigned_member_id) where completed_at is null;

-- ---------------------------------------------------------------------------
-- The only way to assign a chore
-- ---------------------------------------------------------------------------

-- Unlike `complete_chore`, this function is not about the clock — it is about
-- access. `assigned_member_id` is absent from the update grant, so this is not
-- the preferred path, it is the only one.
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
    -- Not a silent unassign. Clearing an allocation is `unassign_chore`, and a
    -- null arriving here is a caller bug rather than an intention — treating it
    -- as "take this off whoever has it" would make a dropped variable look like
    -- a deliberate act.
    raise exception 'assign_chore needs a person; use unassign_chore to clear it';
  end if;

  -- The join to household_devices IS the access rule: a chore in a household
  -- this device has not joined is not found, and the refusal is the same one a
  -- nonexistent id gets. Which of the two you hit is free information. Same
  -- shape and same wording as 0004.
  select c.* into target
  from public.chores c
  join public.household_devices hd on hd.household_id = c.household_id
  where c.id = chore_id and hd.auth_user_id = caller
  for update of c;

  if not found then
    raise exception 'no such chore in your household';
  end if;

  -- Checked here so the refusal is a sentence. The composite foreign key above
  -- would refuse the same write, in Postgres's words rather than ours.
  if not exists (
    select 1 from public.members m
    where m.id = member_id and m.household_id = target.household_id
  ) then
    raise exception 'that person is not in this household';
  end if;

  update public.chores
     set assigned_member_id = member_id
   where id = chore_id
  returning * into target;

  return target;
end;
$$;

-- Take a chore off whoever is holding it. It returns to the unassigned group and
-- their committed minutes fall by exactly its expected minutes — which is not a
-- statement about this function at all, since committed minutes are derived. It
-- is true because the sum is computed at read time. AC 4 asserts it end to end
-- anyway, because "derived, so it must follow" is the reasoning that stops
-- anybody checking.
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
  join public.household_devices hd on hd.household_id = c.household_id
  where c.id = chore_id and hd.auth_user_id = caller
  for update of c;

  if not found then
    raise exception 'no such chore in your household';
  end if;

  update public.chores
     set assigned_member_id = null
   where id = chore_id
  returning * into target;

  return target;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
--
-- One new column, READABLE and not WRITABLE. The select grant is re-issued in
-- full — one statement listing every readable column is the thing a reader can
-- check against src/lib/chores.js's CHORE_COLUMNS in one glance — and the update
-- grant is left exactly as 0003 wrote it.
--
-- There is deliberately no `revoke` in this file. 0003's
-- `revoke select, insert, update on public.chores from authenticated` and its
-- `revoke all ... from anon` already stripped Supabase's default `grant all`,
-- and a column added afterwards inherits no privilege of its own: default
-- privileges apply to new TABLES, not to new columns. That is what makes the
-- additive-by-column convention work, and it is also the statement #36 AC 3
-- mutates — removing 0003's revoke is what makes the direct write succeed.
-- ---------------------------------------------------------------------------

grant select (id, title, expected_minutes, due_on, created_at,
              completed_at, completed_by_member_id, assigned_member_id)
  on public.chores to authenticated;

revoke all on function public.assign_chore(uuid, uuid)   from public, anon;
revoke all on function public.unassign_chore(uuid)       from public, anon;
grant execute on function public.assign_chore(uuid, uuid) to authenticated;
grant execute on function public.unassign_chore(uuid)     to authenticated;
