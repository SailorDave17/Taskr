-- Marking a chore done — story #35.
--
-- Completion lands BEFORE assignment (#36), which inverts the order instinct
-- suggests and is the ordering claim of the whole chore set. Committed minutes
-- computed over assigned chores with no completion state can only GROW, so the
-- load figure drifts upward all week and any re-balance derived from it is
-- computed over work already finished. The charter's third must-become-true is
-- that "fairness is legible to the person who thinks it is unfair — the test is
-- not that a number is displayed; it is that the argument ends". A visibly
-- stale number ends no argument, it starts one. Landing completion first means
-- the fairness figure is correct the first moment anyone sees it, and there is
-- never a released build in which it is not.
--
-- ===========================================================================
-- Why completion goes through a definer function, when a household is already
-- a trust boundary
-- ===========================================================================
--
-- Not access control — the SERVER CLOCK. `completed_at` decides which week a
-- piece of work falls in, and a client clock is a foreign input to the
-- fairness arithmetic: a phone with the date set wrong would move work between
-- weeks, silently and in a way no test on this side could see. The function
-- costs about fifteen lines and means `completed_at` is withheld from the
-- column grants FROM DAY ONE rather than revoked from a shipped write path
-- later, which 0002 records as the expensive version of this mistake.
--
-- This is 0003's convention working as intended: each migration grants update
-- only on the columns IT makes client-editable, the grant set is additive by
-- column, and the "a client cannot write this" test lives in the story that
-- introduces the withheld column. That test is in this story.
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- Applied by a human pasting into the Supabase SQL editor, so a re-paste after
-- a partial failure is the normal path. Columns use `add column if not exists`,
-- the index uses `if not exists`, and the functions use `create or replace`.
-- There are no policies here — 0003's already cover `chores` for every verb —
-- so there is nothing needing the `drop policy if exists` dance.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

-- When the work was finished, by the DATABASE's clock. Null means outstanding,
-- and "outstanding" is defined here as exactly that, with no week boundary:
-- no week concept exists yet, and whether a chore belongs to a particular week
-- is story #44's decision. Deliberately not pre-empted.
alter table public.chores
  add column if not exists completed_at timestamptz;

-- Who finished it. A MEMBER row, not an auth id, for the reason 0001 gives
-- about `members.id` being the durable person: an anonymous session expires
-- after 30 days idle and returns with a new auth id, so attribution keyed to
-- `auth.uid()` would detach a rarely-active member from their own history.
--
-- Owner decision, 2026-08-08, on the noticing question the charter still owes:
-- completing a chore nobody was assigned is ALLOWED and ATTRIBUTED, and nothing
-- surfaces it. That is what actually happens in a household, and refusing it
-- would make the app argue with someone who has just done the dishes — close to
-- the nagging the original problem statement names as the enemy. Recording a
-- fact is not modelling a dimension; whether it ever becomes a product feature
-- stays open. #12 needs this column regardless, and retrofitting it later costs
-- a migration.
alter table public.chores
  add column if not exists completed_by_member_id uuid
  references public.members (id) on delete set null;

-- The outstanding list is the query the UI makes on every load.
create index if not exists chores_outstanding_idx
  on public.chores (household_id, due_on) where completed_at is null;

-- ---------------------------------------------------------------------------
-- The only way to complete a chore
-- ---------------------------------------------------------------------------

-- Resolve which member this device is currently acting as, inside the caller's
-- household. Returns null when the device is joined but has claimed nobody,
-- which is a real state — a phone can be in the household without being a
-- person yet.
create or replace function public.acting_member(target_household uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.members m
  where m.household_id = target_household
    and m.claimed_by = (select auth.uid())
  limit 1;
$$;

create or replace function public.complete_chore(chore_id uuid)
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

  -- The join to household_devices is the access rule: a chore in a household
  -- this device has not joined is not found, and the refusal is the same one a
  -- nonexistent id gets. Which of the two you hit is free information.
  select c.* into target
  from public.chores c
  join public.household_devices hd on hd.household_id = c.household_id
  where c.id = chore_id and hd.auth_user_id = caller
  for update of c;

  if not found then
    raise exception 'no such chore in your household';
  end if;

  -- now() is the DATABASE's clock, and that is the whole point of this
  -- function. The client supplies no timestamp and cannot.
  update public.chores
     set completed_at = now(),
         completed_by_member_id = public.acting_member(target.household_id)
   where id = chore_id
  returning * into target;

  return target;
end;
$$;

-- Undo. A chore marked done in error returns to the outstanding list, and the
-- attribution goes with it — leaving `completed_by_member_id` set on an
-- outstanding chore would record that someone finished work that is not
-- finished.
create or replace function public.uncomplete_chore(chore_id uuid)
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
     set completed_at = null,
         completed_by_member_id = null
   where id = chore_id
  returning * into target;

  return target;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
--
-- The additive-by-column convention 0003 set. This migration makes two new
-- columns READABLE and neither of them WRITABLE, so the select grant is
-- re-issued with the two additions and the update grant is left exactly as
-- 0003 wrote it.
--
-- `completed_at` and `completed_by_member_id` are absent from the update grant
-- deliberately and permanently: both move only through the functions above. A
-- client that could write `completed_at` could put work in a different week,
-- and one that could write `completed_by_member_id` could attribute someone
-- else's work to themselves — or their own to someone else.
--
-- Re-granting select rather than issuing a second `grant select (...)`: both
-- work and are additive, but one statement listing every readable column is
-- the thing a reader can check against the client's column list in one glance.
-- ---------------------------------------------------------------------------

grant select (id, title, expected_minutes, due_on, created_at,
              completed_at, completed_by_member_id)
  on public.chores to authenticated;

revoke execute on function public.acting_member(uuid) from public, anon;
grant execute on function public.acting_member(uuid)   to authenticated;
grant execute on function public.complete_chore(uuid)   to authenticated;
grant execute on function public.uncomplete_chore(uuid) to authenticated;
