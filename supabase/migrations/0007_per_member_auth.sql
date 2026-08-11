-- 0007 — per-member sign-in replaces anonymous device auth (story #62)
--
-- A person signs in as themselves. Before this, a DEVICE signed in anonymously
-- and later proved which person it was holding; `household_devices` was the row
-- RLS asked about and `members.claimed_by` meant "which device session is acting
-- as this person".
--
-- WHY `household_devices` GOES AWAY, since it was deliberate and is now not.
-- 0001 states its whole reason: an anonymous session expires after 30 idle days
-- and returns with a NEW auth id, so keying membership to `auth.uid()` would
-- make a rarely-active member "a stranger to their own history". Per-member
-- sign-in makes the auth id STABLE — the same credential returns the same auth
-- user — so the hazard the table existed to absorb no longer exists. Membership
-- now resolves through `members.claimed_by`, which already references
-- `auth.users(id)` and already carries a unique index.
--
-- What deliberately does NOT change, and is the reason this migration is cheap:
-- `members.id` stays the durable person. Chores, completions, assignments and
-- capacity all reference it and none reference `auth.uid()`. There is no data
-- migration of history here, only of identity.
--
-- Owner decisions taken at pickup, 2026-08-10 (recorded on #62):
--   1. Identifier  — a real email where the member has one, a synthetic address
--                    derived from `members.id` otherwise.
--   2. Credential  — a longer secret for members with a real address, a PIN for
--                    those without. `email is null` is the discriminator; there
--                    is deliberately no separate is_child flag to disagree with.
--   3. Live rows   — a ONE-TIME RE-CLAIM, executed by the owner. See the notice
--                    at the foot of this file; it has an ordering constraint
--                    that will lock the household out if ignored.
--   4. Join code   — retired with the PIN path. A dead admission route that
--                    still works is a second way in.
--
-- Re-runnable like every file here: `if exists` / `if not exists` throughout,
-- `create or replace` for functions, `drop policy if exists` before each policy.
-- A half-applied paste followed by a re-paste is the normal way this is used.

-- ---------------------------------------------------------------------------
-- 1. The identifier
-- ---------------------------------------------------------------------------

-- Nullable on purpose, and the nullability is load-bearing: it is the single
-- discriminator between the two credential policies. A member WITH an address
-- signs in with it and must carry a longer secret; a member WITHOUT one gets a
-- synthetic `<members.id>@taskr.invalid` address they never see or type, and a
-- PIN. `.invalid` is reserved by RFC 2606 and can never resolve, so a synthetic
-- address cannot accidentally reach a real inbox.
--
-- Unique across the table rather than per household: it maps 1:1 to a Supabase
-- auth user, and auth emails are global.
alter table public.members
  add column if not exists email text;

create unique index if not exists members_email_key
  on public.members (lower(email)) where email is not null;

alter table public.members
  drop constraint if exists members_email_shape;
alter table public.members
  add constraint members_email_shape
  check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

comment on column public.members.email is
  'A real address where the member has one, NULL otherwise. Null means the '
  'member signs in with a synthetic <id>@taskr.invalid address and a PIN; '
  'non-null means a real address and a longer secret. Story #62.';

-- ---------------------------------------------------------------------------
-- 2. The membership predicate, and the recursion it has to avoid
-- ---------------------------------------------------------------------------

-- `household_devices` gave every policy a predicate that read a DIFFERENT table
-- from the one being protected. Resolving through `members` instead would put a
-- subquery on `members` inside the policies ON `members` — which is infinite RLS
-- recursion, not a slow query, and Postgres refuses it outright.
--
-- A `security definer` function is the escape, and it is the pattern this schema
-- already uses for `acting_member` and `is_household_organizer`: it runs as the
-- owner, so RLS does not re-enter while evaluating the policy. `stable` so the
-- planner may call it once per statement; `set search_path = ''` so a caller
-- cannot shadow `public` and have this resolve something else.
create or replace function public.current_household_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.household_id
  from public.members m
  where m.claimed_by = (select auth.uid());
$$;

comment on function public.current_household_ids() is
  'Households the signed-in member belongs to. Security definer to avoid RLS '
  'recursion: policies on members cannot subquery members directly. Story #62.';

revoke all on function public.current_household_ids() from public, anon;
grant execute on function public.current_household_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Every policy re-pointed at the new predicate
--
-- Same shape, same permissiveness, same trust boundary: a household is the
-- boundary, and inside it everyone may maintain the roster and the work. The
-- ONLY change is what answers "is the caller in this household".
-- ---------------------------------------------------------------------------

-- households -----------------------------------------------------------------
drop policy if exists households_select_joined on public.households;
create policy households_select_joined
  on public.households for select
  to authenticated
  using (id in (select public.current_household_ids()));

drop policy if exists households_update_joined on public.households;
create policy households_update_joined
  on public.households for update
  to authenticated
  using (id in (select public.current_household_ids()))
  with check (id in (select public.current_household_ids()));

-- members --------------------------------------------------------------------
--
-- The insert policy is the one that changes meaning. Under device auth a joined
-- session could add a member freely. It still can — but a member row with no
-- `claimed_by` is now inert until the Edge Function provisions an auth user for
-- it, so adding a row no longer grants anybody access to anything.
drop policy if exists members_select_same_household on public.members;
create policy members_select_same_household
  on public.members for select
  to authenticated
  using (household_id in (select public.current_household_ids()));

drop policy if exists members_insert_same_household on public.members;
create policy members_insert_same_household
  on public.members for insert
  to authenticated
  with check (household_id in (select public.current_household_ids()));

drop policy if exists members_update_same_household on public.members;
create policy members_update_same_household
  on public.members for update
  to authenticated
  using (household_id in (select public.current_household_ids()))
  with check (household_id in (select public.current_household_ids()));

drop policy if exists members_delete_same_household on public.members;
create policy members_delete_same_household
  on public.members for delete
  to authenticated
  using (household_id in (select public.current_household_ids()));

-- chores ---------------------------------------------------------------------
drop policy if exists chores_select_same_household on public.chores;
create policy chores_select_same_household
  on public.chores for select
  to authenticated
  using (household_id in (select public.current_household_ids()));

drop policy if exists chores_insert_same_household on public.chores;
create policy chores_insert_same_household
  on public.chores for insert
  to authenticated
  with check (household_id in (select public.current_household_ids()));

drop policy if exists chores_update_same_household on public.chores;
create policy chores_update_same_household
  on public.chores for update
  to authenticated
  using (household_id in (select public.current_household_ids()))
  with check (household_id in (select public.current_household_ids()));

drop policy if exists chores_delete_same_household on public.chores;
create policy chores_delete_same_household
  on public.chores for delete
  to authenticated
  using (household_id in (select public.current_household_ids()));

-- member_capacity ------------------------------------------------------------
--
-- Keyed through the member rather than directly, exactly as 0005 wrote it: a
-- capacity row belongs to a member, and the member carries the household.
drop policy if exists member_capacity_select_same_household on public.member_capacity;
create policy member_capacity_select_same_household
  on public.member_capacity for select
  to authenticated
  using (
    member_id in (
      select m.id from public.members m
      where m.household_id in (select public.current_household_ids())
    )
  );

drop policy if exists member_capacity_insert_same_household on public.member_capacity;
create policy member_capacity_insert_same_household
  on public.member_capacity for insert
  to authenticated
  with check (
    member_id in (
      select m.id from public.members m
      where m.household_id in (select public.current_household_ids())
    )
  );

drop policy if exists member_capacity_update_same_household on public.member_capacity;
create policy member_capacity_update_same_household
  on public.member_capacity for update
  to authenticated
  using (
    member_id in (
      select m.id from public.members m
      where m.household_id in (select public.current_household_ids())
    )
  )
  with check (
    member_id in (
      select m.id from public.members m
      where m.household_id in (select public.current_household_ids())
    )
  );

drop policy if exists member_capacity_delete_same_household on public.member_capacity;
create policy member_capacity_delete_same_household
  on public.member_capacity for delete
  to authenticated
  using (
    member_id in (
      select m.id from public.members m
      where m.household_id in (select public.current_household_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Household creation, without a join code and without a device row
-- ---------------------------------------------------------------------------

-- The organizer's own member row is created claimed BY THEM in the same
-- statement. That is what stops a household from being born unreachable: under
-- the new predicate, a household with no claimed member is visible to nobody,
-- including the person who just made it.
-- Drop the previous signature FIRST, which is this schema's established
-- convention: 0002 drops 0001's one-arg version, 0005 drops 0002's three-arg
-- version. Skipping it does not replace anything - it adds an OVERLOAD, and a
-- three-argument call then matches both this and 0005's four-argument version
-- with its defaulted timezone. Measured: `create_household(unknown, unknown,
-- unknown) is not unique`, which reads like a caller bug and is a migration bug.
drop function if exists public.create_household(text, text, text, text);

create or replace function public.create_household(
  household_name text,
  organizer_name text,
  household_timezone text default 'UTC'
)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_household public.households;
  new_member     public.members;
begin
  if (select auth.uid()) is null then
    raise exception 'create_household requires a signed-in user';
  end if;

  -- No explicit timezone validation call here: 0005 wired
  -- `assert_valid_timezone()` as a BEFORE INSERT OR UPDATE trigger on
  -- households, so the insert below validates itself. It is a trigger function
  -- and takes no arguments - calling it directly raises `function
  -- public.assert_valid_timezone(text) does not exist`, which reads like a
  -- missing migration and is a misuse.

  insert into public.households (name, timezone)
  values (household_name, household_timezone)
  returning * into new_household;

  insert into public.members (household_id, display_name, claimed_by)
  values (new_household.id, organizer_name, (select auth.uid()))
  returning * into new_member;

  update public.households
     set organizer_member_id = new_member.id
   where id = new_household.id
  returning * into new_household;

  return new_household;
end;
$$;

revoke all on function public.create_household(text, text, text) from public, anon;
grant execute on function public.create_household(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Retire the device-auth admission routes
--
-- Dropped rather than left in place: a credential path that still works is a
-- second way in, and each of these grants household access without the new
-- identity. `claim_member*` attached a device session to a person, `set_member_pin`
-- minted the credential it checked, and `join_household` admitted a device by
-- shared code.
-- ---------------------------------------------------------------------------

drop function if exists public.claim_member(uuid);
drop function if exists public.claim_member_with_pin(uuid, text);
drop function if exists public.set_member_pin(uuid, text);
drop function if exists public.join_household(text);
drop function if exists public.generate_join_code();
drop function if exists public.assert_valid_pin(text);

-- `has_pin` is a generated column over `pin_hash`, so it goes first.
alter table public.members drop column if exists has_pin;
alter table public.members drop column if exists pin_hash;

alter table public.households drop column if exists join_code;

-- ---------------------------------------------------------------------------
-- 6. The device table, last — nothing references it by here
-- ---------------------------------------------------------------------------

drop policy if exists household_devices_select_own on public.household_devices;
drop table if exists public.household_devices;

-- ---------------------------------------------------------------------------
-- 7. Column grants for the new column
--
-- 0002 established the convention and 0003 inherited it: revoke wholesale, then
-- grant per column, so `select(*)` fails outright rather than quietly omitting
-- a column. `email` joins the readable set and the updatable set — an organizer
-- correcting a typo in an address is ordinary roster maintenance.
--
-- `anon` is revoked wholesale for the reason 0002 gives: no unauthenticated
-- caller has any business reading a household.
-- ---------------------------------------------------------------------------

revoke select, insert, update on public.members from authenticated, anon;

grant select (id, household_id, display_name, weekly_minutes, claimed_by, email, created_at)
  on public.members to authenticated;
grant insert (household_id, display_name, weekly_minutes, email)
  on public.members to authenticated;
grant update (display_name, weekly_minutes, email)
  on public.members to authenticated;

-- `claimed_by` is deliberately NOT client-updatable. It is identity, and it is
-- written only by the provisioning function running as service_role. A client
-- that could set it could attach itself to any member row in its household and
-- become that person.

-- ---------------------------------------------------------------------------
-- 8. The one-time re-claim, and the ordering that makes it survivable
--
-- OWNER ACTION REQUIRED. Read before pasting.
--
-- Existing `claimed_by` values hold anonymous DEVICE auth ids. They are not the
-- people, and under per-member sign-in they would attach the wrong identity to
-- the wrong row, so they are cleared. The consequence is stated plainly because
-- it is severe and brief:
--
--   BETWEEN THIS STATEMENT AND THE FIRST PROVISION, THE HOUSEHOLD IS VISIBLE TO
--   NOBODY FROM THE CLIENT. `current_household_ids()` returns nothing for every
--   caller, so every policy denies. This is not recoverable from the app.
--
-- It IS recoverable from the Edge Function, which runs as service_role and
-- bypasses RLS. The order is therefore load-bearing:
--
--   1. Paste this migration.
--   2. Provision the ORGANIZER first, with the function, from the dashboard or
--      a direct call. That sets their `claimed_by` and restores their access.
--   3. Sign in as the organizer and provision everybody else from the app.
--
-- Doing (3) before (2) is not possible, and attempting it looks exactly like the
-- app being broken. That is why the sequence is here and not only in the issue.
-- ---------------------------------------------------------------------------

update public.members set claimed_by = null where claimed_by is not null;
