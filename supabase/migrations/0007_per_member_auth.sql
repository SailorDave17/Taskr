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
-- 0. Is this the first application? Answered FIRST, because section 1 destroys
--    the evidence.
--
-- Section 7 clears every `claimed_by`, and that is correct exactly once: the
-- values are anonymous DEVICE ids and they have to go. Doing it a second time
-- clears the identities the Edge Function has since written, and locks the
-- household out of its own data with no recovery from the client.
--
-- So the clear needs to know whether this file has run before, and nothing in
-- the DATA can tell it — a device id and a person id are both just a uuid in
-- `claimed_by`. The schema can: `members.email` arrives in section 1 and exists
-- afterwards forever, so its absence right now is exactly "0007 has not run".
--
-- `household_devices` looks like the same signal and is not. It was the first
-- thing tried, and it is wrong for a reason worth recording: re-pasting the
-- whole list runs 0001 again, which recreates that table, so by the time
-- section 7 asked, it was always there. Measured 2026-08-11 — the guard read
-- "first run" on a second paste and cleared the claims anyway.
-- ---------------------------------------------------------------------------

drop table if exists pg_temp.taskr_0007_first_run;
create temporary table taskr_0007_first_run as
select not exists (
  select 1 from information_schema.columns
  where table_schema = 'public'
    and table_name = 'members'
    and column_name = 'email'
) as yes;

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
-- CORRECTED 2026-08-28 (#242): "they never see or type" was the intention here
-- and was never achievable. Sign-in is `signInWithPassword`, so the address is
-- half the credential and somebody has to type it — and because nothing ever
-- collected an address, EVERY member's was the synthetic form, displayed on no
-- screen. The organizer was told to pass on a name and a PIN, and the person
-- could not get in. The sentence is left standing rather than rewritten because
-- this file is the record of what was decided on the day; what changed is that
-- the roster now collects a real address and shows whichever one applies.
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

-- The delete policy carries one clause the others do not, and it is not a
-- tightening for its own sake: under device auth, deleting your own member row
-- was survivable because `household_devices` carried membership INDEPENDENTLY,
-- so you stayed in the household and could pick a person again. This migration
-- drops that table and makes `claimed_by` the sole membership predicate, which
-- silently turns "remove me from the roster" into "lock myself out forever" —
-- `current_household_ids()` returns nothing, every policy above denies, and
-- `households.organizer_member_id` is `on delete set null`, so the household is
-- left with no organizer and visible to nobody. Not recoverable from any client.
--
-- Nothing in the client CHANGED to cause this. `removeMember` and the Remove
-- button are byte-identical to what shipped before; this migration changed what
-- an unchanged call means. That is exactly why the guard belongs here rather
-- than in the component: the component was already correct and still is.
--
-- Today it is not an edge case. Provisioning needs the Edge Function, so the
-- organizer is usually the ONLY claimed member, and their row carries the
-- "· you" badge right next to the Remove button.
drop policy if exists members_delete_same_household on public.members;
create policy members_delete_same_household
  on public.members for delete
  to authenticated
  using (
    household_id in (select public.current_household_ids())
    and claimed_by is distinct from (select auth.uid())
  );

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
-- Keyed on the row's OWN `household_id`, which is how 0005 wrote it. An earlier
-- draft of this migration resolved through `member_id` instead and described
-- itself as matching 0005; it did not, and the difference is not cosmetic. The
-- composite foreign key `member_in_household` is what refuses a capacity row
-- naming a member of another family, and a member-keyed policy refuses that same
-- row at RLS first — so the key stops being the thing under test while the suite
-- still claims to test it. Caught by capacity.pglite's `refuses an override
-- naming a member of another household`, which asserts on the constraint by
-- name.
drop policy if exists member_capacity_select_same_household on public.member_capacity;
create policy member_capacity_select_same_household
  on public.member_capacity for select
  to authenticated
  using (
    household_id in (select public.current_household_ids())
  );

drop policy if exists member_capacity_insert_same_household on public.member_capacity;
create policy member_capacity_insert_same_household
  on public.member_capacity for insert
  to authenticated
  with check (
    household_id in (select public.current_household_ids())
  );

drop policy if exists member_capacity_update_same_household on public.member_capacity;
create policy member_capacity_update_same_household
  on public.member_capacity for update
  to authenticated
  using (
    household_id in (select public.current_household_ids())
  )
  with check (
    household_id in (select public.current_household_ids())
  );

drop policy if exists member_capacity_delete_same_household on public.member_capacity;
create policy member_capacity_delete_same_household
  on public.member_capacity for delete
  to authenticated
  using (
    household_id in (select public.current_household_ids())
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

  -- `email` is taken from `auth.users`, not from a parameter. The organizer has
  -- just signed up, so their real address is already known to the auth schema,
  -- and reading it here is the only way to be sure the discriminator and the
  -- auth account can never disagree — a parameter could be passed a different
  -- address, or omitted, and nothing would notice.
  --
  -- It is null for a member the Edge Function provisions with a synthetic
  -- `<id>@taskr.invalid` address, which is exactly what the column means: null
  -- is "no real address, so a PIN", not "we forgot to fill this in". Without
  -- this line NOTHING in the system ever writes the column and it is a constant
  -- null for every member — the organizer, who is the one person guaranteed to
  -- have a real address, most of all.
  insert into public.members (household_id, display_name, claimed_by, email)
  values (
    new_household.id,
    organizer_name,
    (select auth.uid()),
    (select u.email from auth.users u where u.id = (select auth.uid()))
  )
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
-- 5. The definer functions re-pointed at the new predicate
--
-- Section 3 re-pointed every POLICY. These four are not policies: they are
-- `security definer` functions that carry their own access rule as a join to
-- `household_devices`, which section 6 drops. Nothing errors when that table
-- goes - a plpgsql body resolves its tables when it RUNS, not when it is
-- created - so without this section `drop table` succeeds, the migration
-- reports success, and marking a chore done, undoing it, assigning and
-- unassigning all fail at the first call with `relation
-- "public.household_devices" does not exist`.
--
-- The predicate is the only thing that changes. `in (select
-- public.current_household_ids())` replaces the join, which is the same
-- membership question asked of `members.claimed_by` instead of a device row.
-- The `for update of c` row lock, the not-found wording, and the deliberate
-- refusal to say WHICH of "no such chore" or "not your household" was hit are
-- all preserved exactly as 0004 and 0006 wrote them.
-- ---------------------------------------------------------------------------

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

  select c.* into target
  from public.chores c
  where c.id = chore_id
    and c.household_id in (select public.current_household_ids())
  for update of c;

  if not found then
    raise exception 'no such chore in your household';
  end if;

  update public.chores
     set completed_at = now(),
         completed_by_member_id = public.acting_member(target.household_id)
   where id = chore_id
  returning * into target;

  return target;
end;
$$;

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
  where c.id = chore_id
    and c.household_id in (select public.current_household_ids())
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
     set assigned_member_id = member_id
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
     set assigned_member_id = null
   where id = chore_id
  returning * into target;

  return target;
end;
$$;

-- `acting_member` needs no change: it already resolves through
-- `members.claimed_by`, which is exactly the column this story makes stable.
-- Its comment in 0004 - "returns null when the device is joined but has claimed
-- nobody" - describes a state that can no longer exist, since claiming IS
-- joining now. Left in place rather than rewritten: the function is correct and
-- 0004 is history.

-- ---------------------------------------------------------------------------
-- 6. Retire the device-auth admission routes
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
-- 7. The device table, last — nothing references it by here
-- ---------------------------------------------------------------------------

-- The one-time re-claim runs HERE. See section 9 for what it does and the
-- ordering it forces on the owner.
--
-- Its POSITION is not load-bearing, and an earlier draft of this comment said it
-- was — "the last moment at which 'was this schema on device auth?' is
-- answerable", which is the guard section 0 records as measured-wrong. The flag
-- is a `pg_temp` table created in section 0 and dropped at the very end of the
-- file, so the clear is correct anywhere between them, the foot of the file
-- included. Anyone relocating it on the retracted reasoning would swap a working
-- guard for the one that failed.
--
-- Guarded, because an UNGUARDED clear is not re-runnable and this file claims to
-- be. Measured 2026-08-11: pasting the list a second time cleared every
-- `claimed_by` again and locked the household out of its own data, recoverable
-- only from the Edge Function. A re-paste after a partial failure is the normal
-- way these are applied, so that is not an edge case — it is the documented
-- path.
do $$
begin
  if (select yes from pg_temp.taskr_0007_first_run) then
    update public.members set claimed_by = null where claimed_by is not null;
  end if;
end
$$;

drop policy if exists household_devices_select_own on public.household_devices;
drop table if exists public.household_devices;

-- ---------------------------------------------------------------------------
-- 8. Column grants
--
-- 0002 established the convention and 0003 inherited it: revoke wholesale, then
-- grant per column, so `select(*)` fails outright rather than quietly omitting
-- a column. `email` joins the readable set and the updatable set — an organizer
-- correcting a typo in an address is ordinary roster maintenance.
--
-- `anon` is revoked wholesale for the reason 0002 gives: no unauthenticated
-- caller has any business reading a household.
--
-- `household_id` LEAVES THE READABLE SET, and that is a repair rather than a
-- tightening. The `select(*)` refusal above was never a property of the grant
-- SHAPE — it held because `pin_hash` was withheld, and once this migration drops
-- that column every remaining column was granted, so `select(*)` quietly started
-- succeeding while four separate comments went on asserting it "fails outright".
-- Withholding one column that no client code reads restores the property those
-- comments describe, and it is the convention `chores` (0003) and
-- `member_capacity` (0005) already follow for exactly this column.
--
-- Nothing loses a capability: a client learns which household it is in from
-- `households`, never from a member row, and `household_id` stays INSERTABLE
-- because `addMember` must name the household it is writing into.
-- ---------------------------------------------------------------------------

revoke select, insert, update on public.members from authenticated, anon;

grant select (id, display_name, weekly_minutes, claimed_by, email, created_at)
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
-- 9. The one-time re-claim, and the ordering that makes it survivable
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
--
-- THE STATEMENT ITSELF IS IN SECTION 7, not here — a placement of convenience,
-- not a constraint. What guards it is the `pg_temp` flag section 0 captures
-- BEFORE section 1 adds `members.email`, and that flag is readable until the
-- file's last line, so the clear would be equally correct at the foot.
--
-- This paragraph previously gave a different and RETRACTED reason: that the
-- statement "has to run while `household_devices` still exists, because the
-- presence of that table is what distinguishes a migration from a re-paste".
-- That guard was tried and measured wrong — re-pasting the list runs 0001, and
-- 0001 recreates the table, so it read "first run" on every paste and cleared
-- the claims anyway. Section 0 records the replacement. Both paragraphs were
-- written in the SAME change that retracted the guard, which is why the wrong
-- one survived: there was no older text for a reviewer to notice going stale.
--
-- Unguarded, a re-paste cleared the claims of a household that had already been
-- provisioned — the app looks broken, and the fix is another round of
-- provisioning from outside it.
--
-- So: on the FIRST application this clears every claim and the ordering above
-- is mandatory. On any later application it does nothing at all.
-- ---------------------------------------------------------------------------

-- The first-run flag from section 0 has done its work. Dropped rather than left
-- behind so a later paste in the same session re-answers the question instead of
-- inheriting this one's answer.
drop table if exists pg_temp.taskr_0007_first_run;
