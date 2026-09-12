-- #430 — an organizer can delete their household, with a grace period before
-- it is purged.
--
-- The owner's decisions are on #430 and its parent #427 (2026-09-11). What this
-- file carries:
--
--   1. Two columns on `households`: `deletion_requested_at` and `purge_after`.
--      A household with them set is PENDING DELETION.
--   2. The grace period, seven days, in exactly one place.
--   3. Membership: a household pending deletion is nobody's. The filter goes in
--      the three helpers every policy and RPC resolves membership through, plus
--      the two functions that check membership inline. The complete list was
--      found by searching every migration for a function that compares
--      `claimed_by` to the caller; it is recorded below, not trusted to memory.
--   4. The organizer's three RPCs: request, restore, status.
--   5. The purge's RPCs, executable by `service_role` only. The purge itself is
--      the `purge-deleted-households` Edge Function, called daily by a Vercel
--      cron. That scheduler is a deliberate exception to docs/hosting-decision.md,
--      recorded there; this file only has to make the purge safe to call late,
--      twice, or by the wrong caller.
--
-- Re-runnable: `add column if not exists`, `drop constraint if exists`,
-- `create or replace`, `create table if not exists`, and grants and revokes,
-- which are idempotent.

-- ---------------------------------------------------------------------------
-- 1. The two columns
-- ---------------------------------------------------------------------------

alter table public.households
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists purge_after timestamptz;

-- Both or neither, and the purge always after the request. A half-set pair
-- would be a household the membership filter hides and the purge never finds.
alter table public.households drop constraint if exists households_deletion_is_whole;
alter table public.households add constraint households_deletion_is_whole
  check (
    (deletion_requested_at is null) = (purge_after is null)
    and (purge_after is null or purge_after > deletion_requested_at)
  );

-- 0019's rule: every column of `households` is SELECT-granted, because the
-- client reads `select('*')` and one ungranted column refuses the whole read
-- (grants.pglite.test.js holds it). Granting the pair exposes nothing: a
-- household pending deletion is no longer selectable by anyone (section 3), so
-- a member only ever reads these two as null.
grant select (deletion_requested_at, purge_after) on public.households to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The grace period, in one place
-- ---------------------------------------------------------------------------

-- Seven days — the owner's decision on #430. `src/lib/householdDeletion.js`
-- carries the same number for the confirm's sentence, and a test reads this
-- function's body and compares, so the two cannot drift.
create or replace function public.household_grace_period()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '7 days';
$$;

comment on function public.household_grace_period() is
  'How long a household pending deletion can still be restored before it is '
  'purged. Seven days; story #430.';

revoke all on function public.household_grace_period() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Membership: a household pending deletion is nobody's
--
-- The complete list of functions that decide "is the caller in this household"
-- by comparing `members.claimed_by` to the caller, as of 0041 (measured on
-- #430):
--
--   current_household_ids()     0007   the predicate of ~30 policies and ~18 RPCs
--   acting_member(uuid)         0004   the member row RPCs act as
--   is_household_organizer(uuid) 0002  the organizer-only policies and provision-member
--   apply_assignments(...)      0018   inline
--   redeem_invitation(text)     0041   inline
--
-- (`claim_member` and `claim_member_with_pin` compared `claimed_by` too, and
-- 0007 dropped both. `eligible_members` and `is_member_eligible` are granted to
-- no client.) The first three are patched here; the last two are replaced in
-- section 4 with one condition added and nothing else changed.
-- ---------------------------------------------------------------------------

create or replace function public.current_household_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.household_id
  from public.members m
  join public.households h on h.id = m.household_id
  where m.claimed_by = (select auth.uid())
    and h.deletion_requested_at is null;
$$;

comment on function public.current_household_ids() is
  'Households the signed-in member belongs to and that are not pending deletion. '
  'Security definer to avoid RLS recursion: policies on members cannot subquery '
  'members directly. Story #62; the pending-deletion filter is #430.';

revoke all on function public.current_household_ids() from public, anon;
grant execute on function public.current_household_ids() to authenticated;

create or replace function public.acting_member(target_household uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.members m
  join public.households h on h.id = m.household_id
  where m.household_id = target_household
    and m.claimed_by = (select auth.uid())
    and h.deletion_requested_at is null
  limit 1;
$$;

-- Organizer of a household that is NOT pending deletion. This one function is
-- what the members delete policy (0016), the three invitation policies (0040)
-- and provision-member ask, so all of them refuse a household pending deletion
-- without being touched. The organizer's own restore and status RPCs below do
-- NOT go through it, precisely because they must still reach that household.
create or replace function public.is_household_organizer(target_household uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.households h
    join public.members m on m.id = h.organizer_member_id
    where h.id = target_household
      and m.claimed_by = (select auth.uid())
      and h.deletion_requested_at is null
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. The two inline checks, replaced with one condition added
-- ---------------------------------------------------------------------------

-- apply_assignments — 0018's body exactly, except the membership test, which now
-- asks `acting_member` (patched above) instead of repeating the `claimed_by`
-- comparison inline. One definition of "a member of this household" rather
-- than two that can drift.
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

  -- #430: through acting_member, so a household pending deletion is refused.
  if public.acting_member(apply_assignments.household_id) is null then
    raise exception 'no such household for this member';
  end if;

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

-- redeem_invitation — 0041's body exactly, plus one refusal: an invitation to a
-- household pending deletion cannot be used. It refuses with the SAME sentence
-- as the other four unusable states (0040 Decision 4), so a refusal cannot
-- confirm that a household is being deleted.
create or replace function public.redeem_invitation(code text)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  digest bytea;
  target public.invitations;
  joined public.members;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  digest := extensions.digest(
    lower(btrim(redeem_invitation.code, E' \t\r\n')),
    'sha256'
  );

  select i.* into target
  from public.invitations i
  where i.token_hash = digest;

  if not found
     or target.withdrawn_at is not null
     or target.redeemed_at is not null
     or target.expires_at <= now() then
    raise exception 'that invitation cannot be used';
  end if;

  -- #430: a household pending deletion admits nobody, in the same words.
  if exists (
    select 1 from public.households h
    where h.id = target.household_id
      and h.deletion_requested_at is not null
  ) then
    raise exception 'that invitation cannot be used';
  end if;

  if exists (
    select 1 from public.members m
    where m.household_id = target.household_id
      and m.claimed_by = caller
  ) then
    raise exception 'you are already in that household';
  end if;

  select i.* into target
  from public.invitations i
  where i.id = target.id
  for update;

  if target.redeemed_at is not null or target.withdrawn_at is not null then
    raise exception 'that invitation cannot be used';
  end if;

  insert into public.members (household_id, display_name, weekly_minutes, claimed_by)
  values (target.household_id, 'New member', 0, caller)
  returning * into joined;

  update public.invitations
     set redeemed_at = now(),
         redeemed_by_member_id = joined.id
   where invitations.id = target.id;

  return joined;
end;
$$;

comment on function public.redeem_invitation(text) is
  'Spend an invitation code and join its household: creates the caller''s member '
  'row and stamps the invitation redeemed, under a primary-key lock so one code '
  'admits exactly one person. The only route that can insert into members for a '
  'household the caller is not yet in - members_insert_same_household requires '
  'a membership the redeemer does not have. Refuses an unusable invitation with '
  'ONE sentence for all four states (no such code, expired, withdrawn, already '
  'redeemed) and for a household pending deletion (#430), so a refusal cannot '
  'confirm a code or a household exists, and refuses an existing member before '
  'spending anything. Story #171; the code is normalised with '
  'lower(btrim(code, E'' \t\r\n'')) since 0041 (story #173, AC 8).';

revoke all on function public.redeem_invitation(text) from public, anon;
grant execute on function public.redeem_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The organizer's three RPCs
--
-- Each checks the organizer INLINE rather than through is_household_organizer,
-- because the patched helper is false for a household pending deletion, and
-- restore and status must still reach it.
-- ---------------------------------------------------------------------------

create or replace function public.request_household_deletion(household_id uuid)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target public.households;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  select h.* into target
  from public.households h
  join public.members m on m.id = h.organizer_member_id
  where h.id = request_household_deletion.household_id
    and m.claimed_by = caller
  for update of h;

  if not found then
    raise exception 'only the household''s organizer can delete it';
  end if;

  if target.deletion_requested_at is not null then
    raise exception 'that household is already scheduled for deletion';
  end if;

  update public.households h
     set deletion_requested_at = now(),
         purge_after = now() + public.household_grace_period()
   where h.id = target.id
  returning h.* into target;

  return target;
end;
$$;

comment on function public.request_household_deletion(uuid) is
  'Organizer only: schedule the household for deletion. It disappears for every '
  'member at once and is purged when household_grace_period() has passed, unless '
  'the organizer restores it first. Story #430.';

create or replace function public.restore_household(household_id uuid)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target public.households;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  select h.* into target
  from public.households h
  join public.members m on m.id = h.organizer_member_id
  where h.id = restore_household.household_id
    and m.claimed_by = caller
  for update of h;

  if not found then
    raise exception 'only the household''s organizer can restore it';
  end if;

  if target.deletion_requested_at is null then
    raise exception 'that household is not scheduled for deletion';
  end if;

  -- Past the period it belongs to the purge, even if the purge has not run yet:
  -- a restore racing a late purge must lose, or "seven days" means nothing.
  if target.purge_after <= now() then
    raise exception 'the grace period has ended, and that household is being deleted';
  end if;

  update public.households h
     set deletion_requested_at = null,
         purge_after = null
   where h.id = target.id
  returning h.* into target;

  return target;
end;
$$;

comment on function public.restore_household(uuid) is
  'Organizer only: undo request_household_deletion while the grace period has '
  'not ended. Story #430.';

create or replace function public.household_deletion_status()
returns table (
  household_id uuid,
  household_name text,
  deletion_requested_at timestamptz,
  purge_after timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select h.id, h.name, h.deletion_requested_at, h.purge_after
  from public.households h
  join public.members m on m.id = h.organizer_member_id
  where m.claimed_by = (select auth.uid())
    and h.deletion_requested_at is not null
    -- Restorable only. Past purge_after restore_household refuses, so the
    -- banner must not offer it; the row stays until the purge runs, which can
    -- be a day or more later (#430 review). It ALSO excludes a household that
    -- is not pending: purge_after is null there (the pair is both-or-neither)
    -- and null > now() is never true. So the line above is a spare, kept because
    -- it says what the query is for; the mutation pass removes both to prove it.
    and h.purge_after > now()
  order by h.purge_after;
$$;

comment on function public.household_deletion_status() is
  'Households the caller organizes that are pending deletion and can still be '
  'restored, soonest purge first: what the restore banner reads, since such a '
  'household is no longer selectable. Story #430.';

revoke all on function public.request_household_deletion(uuid) from public, anon;
revoke all on function public.restore_household(uuid) from public, anon;
revoke all on function public.household_deletion_status() from public, anon;
grant execute on function public.request_household_deletion(uuid) to authenticated;
grant execute on function public.restore_household(uuid) to authenticated;
grant execute on function public.household_deletion_status() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The purge's RPCs — service_role only
--
-- Functions rather than table grants, so the exact list of tables service_role
-- may touch (grants.pglite.test.js) does not grow: `households` is not on it,
-- and a function that can only delete a household whose grace period is over
-- is a narrower power than a DELETE grant on the table.
-- ---------------------------------------------------------------------------

-- What the purge must act on, and the sign-ins to deal with afterwards. The
-- claimants are read HERE, before the delete, because the cascade removes the
-- member rows that name them.
create or replace function public.households_due_for_purge()
returns table (household_id uuid, claimants uuid[])
language sql
stable
security definer
set search_path = ''
as $$
  select h.id,
         coalesce(array_agg(m.claimed_by) filter (where m.claimed_by is not null), '{}')
  from public.households h
  left join public.members m on m.household_id = h.id
  where h.purge_after is not null
    and h.purge_after <= now()
  group by h.id, h.purge_after
  order by h.purge_after;
$$;

comment on function public.households_due_for_purge() is
  'service_role only: households whose grace period has ended, each with the '
  'auth users that claimed a member in it. Story #430.';

-- The Google grants the purge revokes for one household: every refresh token
-- there EXCEPT one whose person is still connected in another household. One
-- Google account holds ONE grant with Taskr's single OAuth client, so revoking
-- that token would break the other household's calendar (owner decision at
-- #430's review, 2026-09-11). The row itself still goes with the cascade.
-- "Another household" is any other calendar_tokens row: when that household is
-- purged too, it is processed on its own, this one is gone by then, and its
-- grant is revoked there.
create or replace function public.household_tokens_to_revoke(household_id uuid)
returns table (refresh_token text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.refresh_token
  from public.calendar_tokens t
  join public.members m on m.id = t.member_id
  where t.household_id = household_tokens_to_revoke.household_id
    and not exists (
      select 1
      from public.calendar_tokens other
      join public.members om on om.id = other.member_id
      where m.claimed_by is not null
        and om.claimed_by = m.claimed_by
        and other.household_id <> t.household_id
    );
$$;

comment on function public.household_tokens_to_revoke(uuid) is
  'service_role only: the refresh tokens the purge revokes at Google for one '
  'household, leaving out a person still connected in another household. '
  'Story #430.';

-- Delete one household, but only one whose grace period is over, whoever calls.
-- Idempotent: a second call finds nothing and returns false. The cascade takes
-- every household-scoped row (every foreign key to households is `on delete
-- cascade`, measured on #427).
create or replace function public.purge_household(household_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted integer;
begin
  delete from public.households h
   where h.id = purge_household.household_id
     and h.purge_after is not null
     and h.purge_after <= now();
  get diagnostics deleted = row_count;
  return deleted = 1;
end;
$$;

comment on function public.purge_household(uuid) is
  'service_role only: delete a household whose grace period has ended; false '
  'when there is nothing due to delete, so it is safe to call twice. Story #430.';

-- The record that a purge ran. Vercel Hobby keeps function logs for one hour and
-- alerts on nothing, so without this a purge that silently stopped would be
-- indistinguishable from a quiet week. Counts only: no household or person is
-- named in it.
create table if not exists public.household_purge_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  due integer not null check (due >= 0),
  purged integer not null check (purged >= 0),
  failures integer not null default 0 check (failures >= 0)
);

comment on table public.household_purge_runs is
  'One row per run of the purge-deleted-households function: how many households '
  'were due, purged and failed. Counts only. Written through '
  'record_household_purge_run; no role holds a grant on it. Story #430.';

alter table public.household_purge_runs enable row level security;

-- No policies and no grants, for any role: 0036's revoke idiom, one step
-- tighter. Written only through the function below; read with the SQL editor.
revoke all on public.household_purge_runs from authenticated, anon, public, service_role;

create or replace function public.record_household_purge_run(
  due integer,
  purged integer,
  failures integer
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.household_purge_runs (due, purged, failures)
  values (record_household_purge_run.due, record_household_purge_run.purged,
          record_household_purge_run.failures);
$$;

comment on function public.record_household_purge_run(integer, integer, integer) is
  'service_role only: record one purge run. Story #430.';

revoke all on function public.households_due_for_purge() from public, anon, authenticated;
revoke all on function public.household_tokens_to_revoke(uuid) from public, anon, authenticated;
revoke all on function public.purge_household(uuid) from public, anon, authenticated;
revoke all on function public.record_household_purge_run(integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.households_due_for_purge() to service_role;
grant execute on function public.household_tokens_to_revoke(uuid) to service_role;
grant execute on function public.purge_household(uuid) to service_role;
grant execute on function public.record_household_purge_run(integer, integer, integer)
  to service_role;
