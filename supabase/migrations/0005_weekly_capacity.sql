-- Capacity as a fact about a particular week — story #44.
--
-- The charter says every competitor gets fairness wrong by treating capacity as
-- a constant. Until this migration Taskr did too: `members.weekly_minutes` is a
-- single static integer per person, edited by hand in Roster.jsx, and nothing
-- owned the delta when somebody's week was unusual. That is capacity-as-constant
-- wearing a different name, and it is the precondition of the signature moment —
-- a split cannot respond to a week it cannot see.
--
-- `members.weekly_minutes` is deliberately UNCHANGED and stays the baseline.
-- This adds the override, not a replacement: next week returns to normal on its
-- own because the absence of a row IS the normal case, which is why there is no
-- backfill and no scheduled job.
--
-- ===========================================================================
-- The week begins on MONDAY (owner decision, 2026-08-08)
-- ===========================================================================
--
-- ISO 8601, and chosen for one reason above the others: Postgres computes it
-- natively. `date_trunc('week', ts)` is already Monday-based, so the period key
-- has exactly ONE implementation here and its JS counterpart in
-- src/lib/capacity.js derives the same boundary the same way. Sunday or Saturday
-- would each need explicit offset arithmetic in both languages — two
-- implementations of one boundary, which is the drift #44 AC 7 exists to make a
-- test about. It also keeps the weekend inside a single period rather than
-- splitting it across two, and the weekend is when household chores happen.
--
-- Recorded in docs/capacity-model.md with the alternatives and what they cost.
--
-- ===========================================================================
-- Column grants, again, and for the same reason as 0002
-- ===========================================================================
--
-- Supabase grants ALL on every new table in `public` to `anon` and
-- `authenticated` by default. Row-level security is ROW-level and has nothing to
-- say about which columns, so without the revoke/grant pair below every rule in
-- this file would be advisory — exactly the hole 0002 measured on shipped code,
-- where a correct `claim_member` guard was bypassed by a direct UPDATE.
--
-- This is not hardening around a feature. It is what the feature stands on.

-- ---------------------------------------------------------------------------
-- The household's timezone
-- ---------------------------------------------------------------------------

-- A week boundary is a local-time fact, and the ambient zone of whichever phone
-- happens to ask is not the household's. Two members in different zones must
-- agree on which week it is or their capacities file under different keys.
--
-- Defaulted to UTC rather than left null so an existing household stays valid
-- through a re-paste; the creating device supplies the real value (see
-- create_household below) and any member may correct it.
alter table public.households
  add column if not exists timezone text not null default 'UTC';

-- A check constraint cannot validate this: the only source of truth is
-- `pg_timezone_names`, a view, so any function reading it is STABLE at best and
-- Postgres requires IMMUTABLE in a check. A trigger can, and does — an invalid
-- zone stored here would not fail at write time, it would fail every later read
-- that computes a boundary, which is the worst possible place to discover it.
create or replace function public.assert_valid_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  begin
    perform now() at time zone new.timezone;
  exception when others then
    raise exception 'not a known timezone: %', new.timezone;
  end;
  return new;
end;
$$;

drop trigger if exists households_timezone_valid on public.households;
create trigger households_timezone_valid
  before insert or update of timezone on public.households
  for each row execute function public.assert_valid_timezone();

-- ---------------------------------------------------------------------------
-- The override itself
-- ---------------------------------------------------------------------------

-- `members` needs this before the composite foreign key below can reference it.
-- Without that key an override could name a member of one household and a
-- household_id of another, and the RLS policies key on household_id — so the row
-- would be visible to the wrong family while pointing at a member they cannot
-- see. `if not exists` is not available for constraints, hence the lookup.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'members_id_household_key'
  ) then
    alter table public.members
      add constraint members_id_household_key unique (id, household_id);
  end if;
end
$$;

create table if not exists public.member_capacity (
  id            uuid primary key default extensions.gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  member_id     uuid not null references public.members (id) on delete cascade,

  -- The household-local date the week begins on. A `date`, not a timestamp: the
  -- period is a calendar fact, and storing an instant would reintroduce the zone
  -- question this column exists to answer.
  period_start  date not null,

  minutes       integer not null,
  note          text,

  -- How it was entered. 'extraction' is the plain-language path (#57); a client
  -- may set it, because it is provenance rather than privilege, and a later
  -- accuracy question is answerable only if the data says where it came from.
  source        text not null default 'manual',

  created_at    timestamptz not null default now(),

  -- One override per person per week. A second is a correction, not a second
  -- fact, so it is an update rather than an insert.
  constraint member_capacity_one_per_period unique (member_id, period_start),

  -- The member must belong to the household the row claims. See the unique
  -- constraint above for why this is not merely tidiness.
  constraint member_capacity_member_in_household
    foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade,

  -- Zero is legitimate and means "I have no time this week" — distinct from
  -- having no row, which means "use my baseline". 10080 is a full week.
  constraint member_capacity_minutes_range check (minutes >= 0 and minutes <= 10080),

  constraint member_capacity_source_known check (source in ('manual', 'extraction')),

  -- The teeth behind the Monday decision. Without this the constant is a
  -- convention two callers can disagree about; with it, a row filed under any
  -- other weekday cannot exist at all. `isodow` is 1 for Monday.
  constraint member_capacity_period_is_monday
    check (extract(isodow from period_start) = 1)
);

create index if not exists member_capacity_household_period_idx
  on public.member_capacity (household_id, period_start);

alter table public.member_capacity enable row level security;

-- ---------------------------------------------------------------------------
-- Row-level security — which ROWS
--
-- Postgres has no `create policy if not exists`, and this file is applied by a
-- person pasting it into the SQL editor, so a re-paste is the normal path. Drop
-- first, exactly as 0001 and 0003 do.
-- ---------------------------------------------------------------------------

drop policy if exists member_capacity_select_same_household on public.member_capacity;
create policy member_capacity_select_same_household
  on public.member_capacity for select to authenticated
  using (
    household_id in (
      select d.household_id from public.household_devices d
      where d.auth_user_id = (select auth.uid())
    )
  );

drop policy if exists member_capacity_insert_same_household on public.member_capacity;
create policy member_capacity_insert_same_household
  on public.member_capacity for insert to authenticated
  with check (
    household_id in (
      select d.household_id from public.household_devices d
      where d.auth_user_id = (select auth.uid())
    )
  );

drop policy if exists member_capacity_update_same_household on public.member_capacity;
create policy member_capacity_update_same_household
  on public.member_capacity for update to authenticated
  using (
    household_id in (
      select d.household_id from public.household_devices d
      where d.auth_user_id = (select auth.uid())
    )
  )
  with check (
    household_id in (
      select d.household_id from public.household_devices d
      where d.auth_user_id = (select auth.uid())
    )
  );

drop policy if exists member_capacity_delete_same_household on public.member_capacity;
create policy member_capacity_delete_same_household
  on public.member_capacity for delete to authenticated
  using (
    household_id in (
      select d.household_id from public.household_devices d
      where d.auth_user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Column-level privileges — which COLUMNS
--
-- Revoked from `anon` as well as `authenticated`. No policy above targets anon
-- so it cannot reach a row today, but that is one `to anon` away from being
-- false, and a privilege that has to stay correct is worse than one that is
-- absent. Same reasoning as 0002.
-- ---------------------------------------------------------------------------

revoke all on public.member_capacity from authenticated, anon;

-- `household_id` is absent on purpose, matching 0003's convention on chores: it
-- is written on insert and never read back, because row-level security already
-- guarantees every row this device can see belongs to its household, so the
-- value would be a constant the client can already name. Excluding it also
-- makes `select('*')` FAIL OUTRIGHT on this table rather than quietly omit a
-- column, which is the behaviour that turns a forgotten column list into a
-- loud error instead of a silent one.
grant select (id, member_id, period_start, minutes, note, source, created_at)
  on public.member_capacity to authenticated;

-- `id` and `created_at` are absent: both are the database's to say. A client
-- that can write created_at can file this week's capacity as last week's.
grant insert (household_id, member_id, period_start, minutes, note, source)
  on public.member_capacity to authenticated;

-- Only the two facts a correction changes. `member_id` and `period_start`
-- identify WHICH week and WHOSE — moving an override between people or weeks by
-- UPDATE would slip past the unique constraint's intent, and is a delete plus an
-- insert. This is the grant #44 AC 4's test asserts against.
grant update (minutes, note, source) on public.member_capacity to authenticated;

grant delete on public.member_capacity to authenticated;

-- ---------------------------------------------------------------------------
-- The creating device supplies the household's zone
--
-- A fourth argument with a default, so the three-argument call sites in
-- src/lib/household.js keep working and the zone is not a second round trip that
-- can fail on its own. Dropped and recreated because Postgres cannot add a
-- parameter with `create or replace` — the same move 0002 made when it went from
-- one argument to three.
-- ---------------------------------------------------------------------------

drop function if exists public.create_household(text, text, text);

create or replace function public.create_household(
  household_name  text,
  organizer_name  text,
  organizer_pin   text,
  household_tz    text default 'UTC'
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

  insert into public.households (name, join_code, timezone)
  values (household_name, public.generate_join_code(), household_tz)
  returning * into new_household;

  insert into public.household_devices (auth_user_id, household_id)
  values ((select auth.uid()), new_household.id)
  on conflict (auth_user_id) do update set household_id = excluded.household_id,
                                           joined_at    = now();

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

revoke all on function public.create_household(text, text, text, text) from public, anon;
grant execute on function public.create_household(text, text, text, text) to authenticated;

revoke all on function public.assert_valid_timezone() from public, anon, authenticated;

-- The household's zone is editable by any member of it — a household that moves
-- has one person fix it, and there is no reason to make that the organizer's job
-- when every member already shares the consequence.
--
-- UPDATE is revoked and re-granted per column; SELECT is deliberately LEFT
-- ALONE. Two separate reasons, and the second is the one that bites:
--
-- 1. This policy is the first UPDATE surface `households` has ever had. Default
--    privileges give `authenticated` every column, so without the grant below a
--    member could rewrite `join_code` — inviting strangers or locking the family
--    out — or reassign `organizer_member_id` to themselves. That is 0002's
--    measured hole exactly, and opening the surface without bounding it would
--    reintroduce it.
-- 2. Column-granting SELECT here would break the shipped app. `currentHousehold()`
--    in src/lib/household.js issues `select('*')`, which a column grant makes
--    FAIL OUTRIGHT rather than quietly omit a column — 0003 records that
--    behaviour. #44 AC 4 asks for per-column grants on *new* tables, which
--    `households` is not, so narrowing the read surface is a separate change
--    with its own caller migration and does not ride in on this one.
revoke update on public.households from authenticated, anon;
grant update (name, timezone) on public.households to authenticated;

drop policy if exists households_update_joined on public.households;
create policy households_update_joined
  on public.households for update to authenticated
  using (
    id in (
      select d.household_id from public.household_devices d
      where d.auth_user_id = (select auth.uid())
    )
  )
  with check (
    id in (
      select d.household_id from public.household_devices d
      where d.auth_user_id = (select auth.uid())
    )
  );
