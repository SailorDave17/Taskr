-- 0044 — a redeemed invitation survives its redeemer leaving (#180).
--
-- WHAT IS WRONG TODAY. 0040 wrote two clauses that cannot both hold on the day
-- a member who joined by code leaves or is removed:
--
--   invitations_redeemed_whole
--     check ((redeemed_at is null) = (redeemed_by_member_id is null))
--   invitations_redeemer_in_household
--     ... on delete set null (redeemed_by_member_id)
--
-- The foreign key blanks the who and keeps the when; the check then refuses the
-- row it produced, and Postgres refuses the DELETE that caused it. *Measured*
-- in pglite on 2026-09-16 — #180's sixth cascade read-back, the edge its review
-- found the leave confirm missing: `delete from public.members` as the owning
-- role and `leave_household()` as the member both fail with
--
--   new row for relation "invitations" violates check constraint
--   "invitations_redeemed_whole"
--
-- and the member row survives. So on the live project, since 0040 (applied
-- 2026-09-10) and #173's redeem path (2026-09-11), a member admitted by
-- invitation code can neither leave (0043) nor be removed by the organizer
-- (0016). Nothing in the client changed to cause it: 0040's own two clauses
-- disagree, and no test deleted a redeemer until #180.
--
-- 0040's header calls the symmetric form "the whole-stamp form 0032's purchase
-- columns use". It is not. 0032 measured this exact failure before it was
-- applied anywhere and wrote BOTH of its checks one-directional on purpose —
-- `shopping_runs_closer_implies_close` and `shopping_items_buyer_implies_purchase`
-- — with the comment that the symmetric form "would make removing a member
-- fail on every run they ever closed". This file brings the invitation check
-- into that shape: a redeemer implies a stamp, and a stamp with no redeemer is
-- the real state 0040's own foreign key produces — a redemption whose person
-- has since left. The record of the spent invitation stays, without the name,
-- which is what the Who tab's leave confirm says (#180 AC 3) and what 0040's
-- own FK comment asked for ("a member who later leaves must not take the record
-- of their own admission with them").
--
-- Re-runnable: `drop constraint if exists` then `add constraint`, 0031's
-- pattern. No grant, no policy, no function: `check:live` and
-- `probe:live-grants` read the same on both sides, and the instrument is
-- `pg_get_constraintdef` before and after (docs/access-model.md, #180).

alter table public.invitations
  drop constraint if exists invitations_redeemed_whole;

alter table public.invitations
  drop constraint if exists invitations_redeemer_implies_stamp;

alter table public.invitations
  add constraint invitations_redeemer_implies_stamp
  check (redeemed_by_member_id is null or redeemed_at is not null);

comment on constraint invitations_redeemer_implies_stamp on public.invitations is
  'A redeemer without a stamp is a state nothing writes and is refused; a stamp '
  'with no redeemer is a redemption whose person has since left — 0040''s FK '
  'blanks the who and keeps the when. One-directional on purpose: 0040''s '
  'symmetric form refused every leave and removal of a member admitted by code. '
  'Story #180.';
