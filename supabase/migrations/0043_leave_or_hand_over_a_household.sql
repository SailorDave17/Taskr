-- #431 — a member can leave a household; an organizer hands it over first, or
-- deletes it (#430).
--
-- The owner's decisions are on #427 and #431 (2026-09-11). What this file
-- carries:
--
--   1. `leave_household(household_id)` — the caller leaves. It takes NO member
--      id, so it can only ever remove the person calling it: "nobody can make
--      somebody else leave" is the function's signature, not a check inside it.
--      The members delete policy (0007/0016) and its self-delete refusal are
--      untouched — leaving is a separate, narrower power than deleting a row.
--   2. `transfer_household(household_id, to_member_id)` — the organizer hands
--      the household to a member who has signed in. Until now nothing could
--      change `households.organizer_member_id` after `create_household`.
--   3. `member_tokens_to_revoke(member_id)` — service_role only: the Google
--      grants the `leave-household` Edge Function revokes before the member row
--      (and with it the token row) goes. #430's rule, applied to one person: a
--      token whose person is still connected in another household is left out,
--      because one Google account holds one grant with Taskr's OAuth client.
--
-- The Google revoke and the account deletion are the Edge Function's, because
-- the refresh token is readable only by service_role and deleting an auth user
-- needs `auth.admin`. This file only has to make leaving safe for whoever calls
-- it. The re-deal of the leaver's chores runs in the browser BEFORE the leave
-- (owner decision on #431), because afterwards the leaver can no longer run it.
--
-- A household PENDING DELETION cannot be left (owner decision at #431's review,
-- 2026-09-11). Leaving asks `acting_member`, which 0042 patched so that a
-- pending household is nobody's, so the exit inherits the entrance's refusal —
-- deliberately, and this is why: the household is already going. When the
-- grace period ends the purge revokes every grant and deletes every sign-in that
-- claims nothing else, so a member is out by then without doing anything. The
-- cost, accepted: somebody who wants out sooner waits, and is back in if the
-- organizer restores it.
--
-- Leaving and handing over serialise on the household row (review-fanout,
-- 2026-09-11). `leave_household` locks it before asking whether the caller
-- organizes, and `transfer_household`'s UPDATE needs the same row, so a
-- hand-over racing a leave either lands first — and the leave then refuses the
-- new organizer — or waits, and then fails its foreign key on the member row
-- the leave deleted. Without the lock the two could interleave into a household
-- with no organizer: 0016's dead end.
--
-- Re-runnable: `create or replace`, and grants and revokes, which are idempotent.

-- ---------------------------------------------------------------------------
-- 1. Leaving
-- ---------------------------------------------------------------------------

create or replace function public.leave_household(household_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  leaving uuid;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  -- The caller's own row in this household, through the one helper every RPC
  -- asks (0004, patched by 0042): a household pending deletion is nobody's, so
  -- leaving one is refused like leaving one you were never in.
  leaving := public.acting_member(leave_household.household_id);
  if leaving is null then
    raise exception 'you are not a member of that household';
  end if;

  -- Serialise with transfer_household — see the header. Taken BEFORE the
  -- organizer check, so the check reads a hand-over that committed first.
  perform 1 from public.households h where h.id = leave_household.household_id for update;

  -- The organizer first hands the household over or deletes it (#430). Leaving
  -- as the organizer would set organizer_member_id to NULL and end the
  -- household's ability to provision anyone — 0016's reason, again.
  if public.is_household_organizer(leave_household.household_id) then
    raise exception 'the organizer cannot leave: hand the household over or delete it first';
  end if;

  delete from public.members m where m.id = leaving;
  return true;
end;
$$;

comment on function public.leave_household(uuid) is
  'The caller leaves the household: their own member row is deleted and the '
  'existing foreign keys cascade as they stand. Takes no member id, so it can '
  'only ever remove the caller. Refuses the organizer, who hands the household '
  'over (transfer_household) or deletes it (#430) first. Story #431.';

revoke all on function public.leave_household(uuid) from public, anon;
grant execute on function public.leave_household(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Handing the household over
-- ---------------------------------------------------------------------------

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

  update public.households h
     set organizer_member_id = target.id
   where h.id = transfer_household.household_id
  returning h.* into handed;

  return handed;
end;
$$;

comment on function public.transfer_household(uuid, uuid) is
  'Organizer only: hand the household to another member of it who has signed '
  'in. The only writer of households.organizer_member_id besides '
  'create_household. Story #431.';

revoke all on function public.transfer_household(uuid, uuid) from public, anon;
grant execute on function public.transfer_household(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The leaver's Google grants — service_role only
-- ---------------------------------------------------------------------------

-- household_tokens_to_revoke (0042) for one member rather than a household,
-- with the same exception: a token whose person holds another calendar_tokens
-- row, in any other household, is left out.
create or replace function public.member_tokens_to_revoke(member_id uuid)
returns table (refresh_token text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.refresh_token
  from public.calendar_tokens t
  join public.members m on m.id = t.member_id
  where t.member_id = member_tokens_to_revoke.member_id
    and not exists (
      select 1
      from public.calendar_tokens other
      join public.members om on om.id = other.member_id
      where m.claimed_by is not null
        and om.claimed_by = m.claimed_by
        and other.household_id <> t.household_id
    );
$$;

comment on function public.member_tokens_to_revoke(uuid) is
  'service_role only: the refresh tokens the leave-household function revokes '
  'at Google for one member, leaving out a person still connected in another '
  'household. Story #431.';

revoke all on function public.member_tokens_to_revoke(uuid) from public, anon, authenticated;
grant execute on function public.member_tokens_to_revoke(uuid) to service_role;
