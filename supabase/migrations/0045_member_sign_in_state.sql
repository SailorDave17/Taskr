-- 0045 — whether a member's sign-in has been accepted, for the roster (#458).
--
-- WHAT IS WRONG TODAY. The Who tab labels a row "Signed in" whenever
-- `members.claimed_by` is set. `provision-member`'s invite branch sets it the
-- moment `inviteUserByEmail` returns, while the auth user is still unconfirmed,
-- so a person who has opened nothing reads exactly like one who has joined —
-- and is offered *Email a reset link* for an account that has never had a
-- password. *Measured on production during #178, 2026-09-16*:
--
--                                  invited 02:44:12    accepted 02:45:12
--   auth.users.email_confirmed_at  null                2026-09-16 02:45:12Z
--   members.claimed_by             set                 set
--   roster label                   Signed in           Signed in
--
-- `email_confirmed_at` is the fact the screen wants and `claimed_by` is the fact
-- it reads. The client cannot read `auth.users`, so this file adds one read that
-- can.
--
-- `member_sign_in_states(household_id)` returns, for every CLAIMED member of a
-- household the caller belongs to, when their invitation was last sent and when
-- their address was confirmed. A member with no claim has no row: the client
-- already knows that state from `claimed_by` being null, and a row of nulls
-- would say nothing more.
--
-- Two fields and no more. `auth.users` holds far more (the address it signs in
-- with, the last sign-in, provider identities, metadata) and none of it is
-- the roster's business. Every household member may call it (owner decision on
-- #458, 2026-09-16): the label renders on every member's roster today, and a
-- member's roster that says "Signed in" for somebody who has not joined is the
-- same defect as the organizer's. The re-send control stays organizer-only in
-- the client, and `provision-member` refuses anybody else regardless.
--
-- WHY A FUNCTION RATHER THAN COLUMNS ON `members` (owner decision, #458). A copy
-- would need a trigger inside Supabase's `auth` schema to learn when a person
-- accepts, plus a backfill, and it could still disagree with the account it was
-- copied from. Read at the source instead, the answer cannot drift.
--
-- `invited_at` is GoTrue's: it is stamped when an invitation is sent, and a
-- re-send to a still-unconfirmed account stamps it again, which is what makes
-- "sent when" and "has the one-hour link expired" answerable from it
-- (`mailer_otp_exp = 3600`, docs/deploy-runbook.md §2). Read off GoTrue's
-- `sendInvite` (supabase/auth `internal/api/mail.go`, 2026-09-16): the stamp is
-- written only AFTER the mail is accepted, so a refused re-send leaves the
-- previous one standing — which is the honest reading, since no new link went. An account minted by the
-- retired `provision` action (#87, before #191) was created confirmed and never
-- invited, so it reads `invited_at` null and `confirmed_at` set: joined.
--
-- Security definer, because `authenticated` holds nothing on `auth.users` and
-- must not. The household check is the function's own and does not rely on RLS,
-- which a definer bypasses: `target_household` must be one of
-- `current_household_ids()`, so a household the caller is not in, or one
-- pending deletion (0042), answers no rows rather than an error. That matches
-- how RLS answers a read of somebody else's members.
--
-- Re-runnable: `create or replace`, then the comment and the grants, in 0042's
-- spelling (`from public, anon`, which 0034 measured is not the same as
-- `from public` on the live project).

create or replace function public.member_sign_in_states(target_household uuid)
returns table (
  member_id uuid,
  invited_at timestamptz,
  confirmed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, u.invited_at, u.email_confirmed_at
  from public.members m
  join auth.users u on u.id = m.claimed_by
  where m.household_id = target_household
    and target_household in (select public.current_household_ids());
$$;

comment on function public.member_sign_in_states(uuid) is
  'For each claimed member of a household the caller belongs to: when their '
  'invitation was last sent and when their address was confirmed, read from '
  'auth.users. Null confirmed_at means invited and not yet accepted. Two fields '
  'only; a household the caller is not in answers no rows. Story #458.';

revoke all on function public.member_sign_in_states(uuid) from public, anon;
grant execute on function public.member_sign_in_states(uuid) to authenticated;
