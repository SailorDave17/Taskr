-- Household and roster — story #5, PR 1 of 3.
--
-- This migration is the security spine of the app. It lands before any UI so the
-- access rules cannot be squeezed out at the end of the story.
--
-- The access model (owner decision, 2026-08-05): a household join code plus
-- device-level anonymous auth, then pick-yourself from the roster. See
-- docs/access-model.md for the reasoning and for the honest statement of what a
-- shared code does and does not protect.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- The scoping entity. Every other row in the app hangs off a household.
create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 60),
  join_code   text not null unique check (join_code ~ '^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$'),
  created_at  timestamptz not null default now()
);

-- Membership of a *device session* in a household.
--
-- This is the table RLS asks about, and it is deliberately separate from
-- `members`. An anonymous Supabase session expires after 30 days of inactivity
-- and the user then comes back with a NEW auth id. If membership or attribution
-- were keyed to the auth id, a rarely-active family member would silently become
-- a stranger to their own history.
create table if not exists public.household_devices (
  auth_user_id  uuid primary key references auth.users (id) on delete cascade,
  household_id  uuid not null references public.households (id) on delete cascade,
  joined_at     timestamptz not null default now()
);

create index if not exists household_devices_household_id_idx
  on public.household_devices (household_id);

-- A person in the household, and the row the app owns.
--
-- `id` is the durable identity: chores, completions and the expected-vs-actual
-- history in later stories all reference THIS, never auth.uid(). `claimed_by` is
-- only ever "which device session is currently acting as this person", and it is
-- expected to change over the life of the household.
create table if not exists public.members (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  display_name   text not null check (length(btrim(display_name)) between 1 and 40),
  weekly_minutes integer not null default 0 check (weekly_minutes >= 0 and weekly_minutes <= 10080),
  claimed_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists members_household_id_idx on public.members (household_id);

-- One device acts as at most one person, so "who did this" is never ambiguous.
create unique index if not exists members_claimed_by_key
  on public.members (claimed_by) where claimed_by is not null;

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- Enabled on every table, with no permissive fallback. A device that has not
-- joined a household can see nothing at all — not an empty household, nothing.
-- The anon key is publishable ONLY because these policies exist; it is inlined
-- into the client bundle and readable by anyone who views source.
-- ---------------------------------------------------------------------------

alter table public.households        enable row level security;
alter table public.household_devices enable row level security;
alter table public.members           enable row level security;

-- A session can see its own membership row and nothing else. Every policy below
-- reads through this one, so it is the root of the whole scheme.
create policy household_devices_select_own
  on public.household_devices for select
  to authenticated
  using (auth_user_id = (select auth.uid()));

-- Households: visible only to a session that has joined them.
create policy households_select_joined
  on public.households for select
  to authenticated
  using (
    id in (
      select hd.household_id from public.household_devices hd
      where hd.auth_user_id = (select auth.uid())
    )
  );

-- Members: readable and writable by any joined session in the same household.
-- A household is a trust boundary; inside it, everyone can maintain the roster.
create policy members_select_same_household
  on public.members for select
  to authenticated
  using (
    household_id in (
      select hd.household_id from public.household_devices hd
      where hd.auth_user_id = (select auth.uid())
    )
  );

create policy members_insert_same_household
  on public.members for insert
  to authenticated
  with check (
    household_id in (
      select hd.household_id from public.household_devices hd
      where hd.auth_user_id = (select auth.uid())
    )
  );

create policy members_update_same_household
  on public.members for update
  to authenticated
  using (
    household_id in (
      select hd.household_id from public.household_devices hd
      where hd.auth_user_id = (select auth.uid())
    )
  )
  with check (
    household_id in (
      select hd.household_id from public.household_devices hd
      where hd.auth_user_id = (select auth.uid())
    )
  );

create policy members_delete_same_household
  on public.members for delete
  to authenticated
  using (
    household_id in (
      select hd.household_id from public.household_devices hd
      where hd.auth_user_id = (select auth.uid())
    )
  );

-- Deliberately absent: any INSERT/UPDATE/DELETE policy on `households` or
-- `household_devices`. Those rows are created only by the two functions below,
-- which run as definer. A client cannot mint a household, forge a membership, or
-- rewrite a join code by any path, because there is no policy that would let it.

-- ---------------------------------------------------------------------------
-- The only two ways in
-- ---------------------------------------------------------------------------

-- Join codes avoid characters that are misread when read aloud or over a phone:
-- no 0/O, no 1/I/L, no U (which is heard as "you"). 30 symbols, 8 positions.
create or replace function public.generate_join_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  candidate text;
  i integer;
begin
  for attempt in 1..20 loop
    candidate := '';
    for i in 1..8 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    if not exists (select 1 from public.households h where h.join_code = candidate) then
      return candidate;
    end if;
  end loop;
  -- 30^8 is ~656 billion; twenty collisions in a row means something is wrong
  -- with the generator, and inventing a code anyway would hide it.
  raise exception 'could not generate a unique join code after 20 attempts';
end;
$$;

-- Create a household and put the caller in it, atomically. Returns the new
-- household so the caller learns its join code in the same round trip.
create or replace function public.create_household(household_name text)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_household public.households;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;

  insert into public.households (name, join_code)
  values (household_name, public.generate_join_code())
  returning * into new_household;

  insert into public.household_devices (auth_user_id, household_id)
  values ((select auth.uid()), new_household.id)
  on conflict (auth_user_id) do update set household_id = excluded.household_id,
                                           joined_at    = now();

  return new_household;
end;
$$;

-- Join an existing household by code. Normalisation happens here as well as in
-- the client, because the client is not the only possible caller and a rule
-- enforced in one place is a rule with a way around it.
create or replace function public.join_household(code text)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalised text;
  target public.households;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;

  normalised := upper(regexp_replace(coalesce(code, ''), '[^a-zA-Z0-9]', '', 'g'));

  select * into target from public.households h where h.join_code = normalised;
  if not found then
    -- Deliberately identical for "no such code" and a malformed one: telling a
    -- guesser which of the two they hit is free information.
    raise exception 'no household matches that code';
  end if;

  insert into public.household_devices (auth_user_id, household_id)
  values ((select auth.uid()), target.id)
  on conflict (auth_user_id) do update set household_id = excluded.household_id,
                                           joined_at    = now();

  return target;
end;
$$;

-- Claim a member row as "this is me on this device". Enforced server-side so two
-- phones cannot both claim the same person by racing the UI.
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

  -- FOR UPDATE, so a second phone claiming the same person waits and then loses
  -- on the check below rather than both reading "unclaimed" and both writing.
  select m.* into target
  from public.members m
  join public.household_devices hd on hd.household_id = m.household_id
  where m.id = member_id and hd.auth_user_id = caller
  for update of m;

  if not found then
    raise exception 'no such member in your household';
  end if;

  if target.claimed_by is not null and target.claimed_by <> caller then
    raise exception 'that person is already claimed on another device';
  end if;

  update public.members set claimed_by = caller where id = member_id
  returning * into target;

  return target;
end;
$$;

revoke all on function public.generate_join_code() from public, anon, authenticated;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.join_household(text)   to authenticated;
grant execute on function public.claim_member(uuid)     to authenticated;
