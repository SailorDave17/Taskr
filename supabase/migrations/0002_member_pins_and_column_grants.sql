-- Per-member credentials, and the column grants that make them mean anything —
-- story #23.
--
-- Owner decision, 2026-08-05: per-member credentials, NOT a shared household
-- join code as the identity. Owner decision, 2026-08-06, on how: an
-- organizer-set PIN carried on the member row, because an organizer cannot
-- create another person's Supabase auth user from a browser — `signUp()` would
-- sign the organizer in as the child, and `auth.admin.createUser()` needs the
-- service key, which must never reach a client bundle.
--
-- What that trade buys and costs is written in docs/access-model.md. The short
-- version: `auth.uid()` still identifies the DEVICE, and the PIN is what proves
-- which PERSON that device is acting as.
--
-- ===========================================================================
-- Read this before anything else: why the grants below are the real change
-- ===========================================================================
--
-- 0001 put every write rule in `claim_member()` and trusted clients to call it.
-- They do not have to. `members_update_same_household` grants UPDATE on the
-- whole row, Supabase's default privileges give `authenticated` every column,
-- and RLS is row-level — it has nothing to say about which columns.
--
-- Measured against the live project, 2026-08-06, with the publishable key:
--
--   claim_member RPC as device B      -> REFUSED: already claimed on another device
--   UPDATE members SET claimed_by=B   -> ALLOWED, 1 row changed, identity taken
--
-- So the RPC's FOR UPDATE race check was real and optional, which is the same
-- as absent. A PIN stored on a row that any household device can overwrite
-- would have been decorative in exactly the same way. The column grants are
-- therefore not hardening added around this story's feature — they are what the
-- feature stands on, and they close a live hole in shipped code.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

-- The credential. bcrypt via pgcrypto; never selectable by a client (see the
-- grants below), because a household sibling who can read the hash can attack a
-- four-digit PIN offline at their leisure.
alter table public.members
  add column if not exists pin_hash text;

-- What the UI actually needs to know, exposed without exposing the hash. A
-- generated column can be granted independently, which a `pin_hash is not null`
-- expression in a view could not be without a second object to keep in step.
alter table public.members
  add column if not exists has_pin boolean
  generated always as (pin_hash is not null) stored;

-- Who may set and reset PINs. A MEMBER row, not an auth id, for the same reason
-- attribution is keyed to members.id in 0001: an anonymous session expires after
-- 30 days idle and comes back with a new auth id. Keying the organizer to a
-- session would silently disenfranchise the organizer after a quiet month.
alter table public.households
  add column if not exists organizer_member_id uuid
  references public.members (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Column-level privileges
--
-- RLS decides WHICH ROWS. These decide WHICH COLUMNS, and nothing else in
-- Postgres does. Without them every function below is advisory.
--
-- `anon` is revoked as well as `authenticated`. No policy in 0001 targets anon,
-- so it cannot reach a row today — but that is one `to anon` away from being
-- false, and a privilege that has to stay correct is worse than one that is
-- simply absent.
-- ---------------------------------------------------------------------------

revoke select, insert, update on public.members from authenticated, anon;

-- pin_hash is deliberately NOT in this list.
grant select (id, household_id, display_name, weekly_minutes, claimed_by, has_pin, created_at)
  on public.members to authenticated;

-- A client may create a person and describe them. It may not decide, at insert
-- time, who that person already is or what their credential is.
grant insert (household_id, display_name, weekly_minutes)
  on public.members to authenticated;

-- The roster is editable inside the household — that was 0001's decision and it
-- stands. `claimed_by` and `pin_hash` leave the set: they now move only through
-- the definer functions below.
grant update (display_name, weekly_minutes)
  on public.members to authenticated;

-- ---------------------------------------------------------------------------
-- Who is the organizer
-- ---------------------------------------------------------------------------

-- True when the caller's device is currently acting as the household's
-- organizer. A household with no organizer_member_id — every household created
-- before this migration — returns false, so PIN operations there fail closed
-- rather than falling back to "anyone in the household may". Those are test
-- households; docs/access-model.md carries the statement that removes them.
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
  );
$$;

-- ---------------------------------------------------------------------------
-- A PIN must be usable by a nine-year-old and not be one digit long
-- ---------------------------------------------------------------------------

create or replace function public.assert_valid_pin(candidate text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  trimmed text := btrim(coalesce(candidate, ''));
begin
  if length(trimmed) < 4 or length(trimmed) > 12 then
    raise exception 'a PIN must be between 4 and 12 characters';
  end if;
  return trimmed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Creating the household now creates its organizer
--
-- The 1-argument form from 0001 is dropped rather than kept alongside. Leaving
-- it would leave a route that creates a household with no organizer, which is
-- exactly the state the `is_household_organizer` check above fails closed on —
-- a supported way to build something unusable.
-- ---------------------------------------------------------------------------

drop function if exists public.create_household(text);

create or replace function public.create_household(
  household_name text,
  organizer_name text,
  organizer_pin  text
)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_household public.households;
  organizer     public.members;
  checked_pin   text;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;

  checked_pin := public.assert_valid_pin(organizer_pin);

  insert into public.households (name, join_code)
  values (household_name, public.generate_join_code())
  returning * into new_household;

  insert into public.household_devices (auth_user_id, household_id)
  values ((select auth.uid()), new_household.id)
  on conflict (auth_user_id) do update set household_id = excluded.household_id,
                                           joined_at    = now();

  -- The organizer is a person in the household like anyone else, claimed by the
  -- device that just created it and carrying a PIN from the first moment. A PIN
  -- set later is a window in which the organizer cannot move to a new phone.
  insert into public.members (household_id, display_name, weekly_minutes, claimed_by, pin_hash)
  values (
    new_household.id,
    organizer_name,
    0,
    (select auth.uid()),
    extensions.crypt(checked_pin, extensions.gen_salt('bf'))
  )
  returning * into organizer;

  update public.households
     set organizer_member_id = organizer.id
   where id = new_household.id
  returning * into new_household;

  return new_household;
end;
$$;

-- ---------------------------------------------------------------------------
-- Setting and resetting a PIN — the organizer, never a self-service flow
-- ---------------------------------------------------------------------------

create or replace function public.set_member_pin(member_id uuid, new_pin text)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  target      public.members;
  checked_pin text;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;

  checked_pin := public.assert_valid_pin(new_pin);

  select m.* into target from public.members m where m.id = member_id;
  if not found then
    raise exception 'no such member';
  end if;

  if not public.is_household_organizer(target.household_id) then
    raise exception 'only the household organizer can set or reset a PIN';
  end if;

  update public.members
     set pin_hash = extensions.crypt(checked_pin, extensions.gen_salt('bf'))
   where id = member_id
  returning * into target;

  -- Resetting someone's PIN releases the phone currently acting as them.
  -- Otherwise a reset would change the credential while leaving the person the
  -- reset was aimed at still signed in as themselves.
  if target.id <> (select h.organizer_member_id from public.households h
                    where h.id = target.household_id) then
    update public.members set claimed_by = null where id = member_id
    returning * into target;
  end if;

  return target;
end;
$$;

-- ---------------------------------------------------------------------------
-- Claiming a person
-- ---------------------------------------------------------------------------

-- Unchanged in spirit from 0001, with one refusal added: a member who has a PIN
-- cannot be claimed without it. Without this the new function below would be an
-- alternative route rather than the only one.
create or replace function public.claim_member(member_id uuid)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.members;
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  select m.* into target
  from public.members m
  join public.household_devices hd on hd.household_id = m.household_id
  where m.id = member_id and hd.auth_user_id = caller
  for update of m;

  if not found then
    raise exception 'no such member in your household';
  end if;

  if target.pin_hash is not null then
    raise exception 'that person has a PIN — use claim_member_with_pin';
  end if;

  if target.claimed_by is not null and target.claimed_by <> caller then
    raise exception 'that person is already claimed on another device';
  end if;

  update public.members set claimed_by = caller where id = member_id
  returning * into target;

  return target;
end;
$$;

-- Claim a person by proving you are them.
--
-- Deliberately allows taking over a member already claimed on another device,
-- which claim_member refuses. That is the whole point of a credential: the same
-- person on a new phone must be able to say so, and holding the PIN is what
-- makes them the same person. Without it, a lost phone would strand an identity
-- permanently and the only repair would be an organizer reset.
create or replace function public.claim_member_with_pin(member_id uuid, pin text)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.members;
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  select m.* into target
  from public.members m
  join public.household_devices hd on hd.household_id = m.household_id
  where m.id = member_id and hd.auth_user_id = caller
  for update of m;

  if not found then
    raise exception 'no such member in your household';
  end if;

  if target.pin_hash is null then
    raise exception 'that person has no PIN — use claim_member';
  end if;

  -- One message for a wrong PIN and for a member that cannot be claimed. Which
  -- of the two you hit is free information to someone guessing.
  if target.pin_hash <> extensions.crypt(pin, target.pin_hash) then
    raise exception 'that PIN is not right';
  end if;

  -- One device acts as at most one person; drop any other claim this device
  -- holds before taking this one, or the unique index on claimed_by rejects it.
  update public.members set claimed_by = null
   where claimed_by = caller and id <> member_id;

  update public.members set claimed_by = caller where id = member_id
  returning * into target;

  return target;
end;
$$;

-- ---------------------------------------------------------------------------
-- Execution privileges
-- ---------------------------------------------------------------------------

revoke all on function public.assert_valid_pin(text)        from public, anon, authenticated;
revoke all on function public.is_household_organizer(uuid)  from public, anon;

grant execute on function public.create_household(text, text, text) to authenticated;
grant execute on function public.set_member_pin(uuid, text)         to authenticated;
grant execute on function public.claim_member_with_pin(uuid, text)  to authenticated;
grant execute on function public.is_household_organizer(uuid)       to authenticated;
