-- 0048 — the household is handed only to a member who has accepted (#467).
--
-- WHAT IS WRONG TODAY. `transfer_household` (0043) refuses a member whose
-- `claimed_by` is null, and nothing else. #458 measured that `claimed_by` is
-- set the moment an invitation is SENT (`provision-member`'s invite branch,
-- #341), while the auth user is still unconfirmed — so an organizer can hand
-- the household to a person who has never opened their invitation. The
-- hand-over keeps the old organizer as an ordinary member, and an ordinary
-- member cannot take it back: if the invited person never arrives, the
-- household has an organizer who cannot sign in, which is 0016's dead end
-- reached by a different road.
--
-- `auth.users.email_confirmed_at` is the fact that says a person has joined —
-- 0045 reads it for the roster's label for the same reason. This file adds
-- that one check to the function and changes nothing else in it. The roster
-- stops OFFERING an unaccepted member in the same story (Roster.jsx); the
-- client filter is manners, this function is the boundary.
--
-- Which accounts it refuses, *measured on the live project 2026-09-18* with a
-- read-only count before the file was written: 13 claimed members, 1 with an
-- unconfirmed account (an invitation outstanding), 0 of them organizers, and
-- 0 unconfirmed accounts that were never invited. An account minted confirmed
-- by the retired `provision` action (#87, before #191) reads
-- `email_confirmed_at` set, so no member who signs in today is newly refused.
--
-- The check reads `auth.users` directly, not through 0045's
-- `member_sign_in_states`: that function answers only for the caller's own
-- households and is a read for the client, and the fact wanted here is one
-- column on one row. This is still `security definer`, so the read needs no
-- grant — `authenticated` holds nothing on `auth.users` and must not.
--
-- A claimed member whose account row is MISSING is refused as unaccepted too.
-- `claimed_by`'s foreign key makes that impossible, and failing closed costs
-- nothing if it ever is not.
--
-- Re-pasting 0043 after this file restores the claim-only body; re-paste this
-- one after it. Re-runnable on its own: `create or replace`, then the comment
-- and the grants, in 0042's spelling (`from public, anon`, which 0034 measured
-- is not the same as `from public` on the live project).

create or replace function public.transfer_household(household_id uuid, to_member_id uuid)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target public.members;
  handed public.households;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  -- The patched helper, so a household pending deletion cannot change hands.
  if not public.is_household_organizer(transfer_household.household_id) then
    raise exception 'only the household''s organizer can hand it over';
  end if;

  select m.* into target
  from public.members m
  where m.id = transfer_household.to_member_id
    and m.household_id = transfer_household.household_id;

  if not found then
    raise exception 'that person is not in this household';
  end if;
  -- An organizer who cannot sign in cannot provision, invite or remove anyone,
  -- which is the dead end 0016 exists to prevent.
  if target.claimed_by is null then
    raise exception 'hand the household to somebody who has signed in';
  end if;
  if target.claimed_by = caller then
    raise exception 'you already organize this household';
  end if;
  -- #467 — and an invitation that has not been accepted is not a sign-in yet.
  -- `claimed_by` is set when the invitation is sent (#341); the account is
  -- confirmed when its link is followed.
  if not exists (
    select 1 from auth.users u
    where u.id = target.claimed_by
      and u.email_confirmed_at is not null
  ) then
    raise exception '% has not accepted their invitation yet, so the household cannot be handed to them',
      target.display_name;
  end if;

  update public.households h
     set organizer_member_id = target.id
   where h.id = transfer_household.household_id
  returning h.* into handed;

  return handed;
end;
$$;

comment on function public.transfer_household(uuid, uuid) is
  'Organizer only: hand the household to another member of it who has signed '
  'in and accepted their invitation (auth.users.email_confirmed_at set, #467). '
  'The only writer of households.organizer_member_id besides create_household. '
  'Story #431.';

revoke all on function public.transfer_household(uuid, uuid) from public, anon;
grant execute on function public.transfer_household(uuid, uuid) to authenticated;
