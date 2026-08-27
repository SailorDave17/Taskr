-- 0016 — removing a member is the organizer's alone
--
-- Story #152. Found by the 2026-08-26 `groom-backlog` run as set-level issue S6,
-- and filed ahead of the multi-household backlog because it depends on none of
-- it: this is reachable today, with one household, on the deployed app.
--
-- WHY 0016 AND NOT 0015: `feature/12-actuals-capture` already carries a `0015`.
-- This file depends on nothing in it and may be pasted before or after it; the
-- number avoids a collision rather than expressing an ordering.
--
-- WHAT IS WRONG TODAY
--
-- `members_delete_same_household` (0001, re-pointed by 0007) permits any member
-- of a household to delete any OTHER member of it:
--
--     using (
--       household_id in (select public.current_household_ids())
--       and claimed_by is distinct from (select auth.uid())
--     )
--
-- The second clause is 0007's and is not the gap. It stops SELF-removal, and
-- 0007's header explains at length why that had to be forbidden: after 0007
-- `claimed_by` is the sole membership predicate, so removing your own row is
-- "lock myself out forever". That clause is preserved here exactly.
--
-- The gap is that A may remove B. When B is the organizer:
--
--   * `households.organizer_member_id` is `on delete set null` (0002), so it
--     becomes NULL;
--   * `create_household` is the ONLY thing in this schema that ever writes that
--     column, so there is no route — from any client, at any privilege the app
--     holds — to appoint a successor;
--   * `is_household_organizer()` then returns false for everybody, permanently,
--     and every organizer-only operation is refused for the life of the
--     household. Provisioning a sign-in is the one that matters: nobody new can
--     ever be given access, and nobody's credential can ever be reset.
--
-- The household itself survives — the remaining claimed members still resolve it
-- through `current_household_ids()` — which is the one respect in which this is
-- LESS severe than the self-removal case 0007 describes. What is lost for good
-- is the ability to give anyone a way in.
--
-- Not hypothetical: it needs two claimed members, which is the ordinary state
-- since `provision-member` shipped in #87.
--
-- THE FIX, AND WHY IT IS ONE CLAUSE
--
-- `public.is_household_organizer(uuid)` already exists (0002) and is exactly the
-- predicate wanted: `security definer`, so it reads `households` and `members`
-- without recursing through their policies, and it FAILS CLOSED on a household
-- whose `organizer_member_id` is NULL — which is precisely the damaged state
-- this migration exists to prevent, so an already-damaged household does not
-- become removable-by-anyone as a side effect.
--
-- Re-runnable: `drop policy if exists` then `create policy`, the shape every
-- policy in this schema uses, so a re-paste is a no-op.
--
-- SAFE ON EXISTING DATA. A policy is evaluated per statement, so this changes
-- what future deletes are permitted and touches no row. It is strictly NARROWER
-- than what it replaces — every delete it permits was already permitted — so
-- nothing that works today stops working for anyone who is the organizer.
--
-- INVISIBLE TO `check:live`, like `0013` before it. That probe reads tables,
-- columns, RPCs and functions; it does not read policies, so it reads the same
-- on both sides of this paste. `docs/access-model.md` records that rather than
-- letting a green run be mistaken for evidence the paste happened.

drop policy if exists members_delete_same_household on public.members;

create policy members_delete_same_household
  on public.members for delete
  to authenticated
  using (
    household_id in (select public.current_household_ids())
    -- 0007's clause, unchanged: you may not remove yourself.
    and claimed_by is distinct from (select auth.uid())
    -- #152: and only the organizer may remove anybody else.
    and public.is_household_organizer(household_id)
  );

comment on policy members_delete_same_household on public.members is
  'Removing a member is the organizer''s alone (#152). Before 0016 any member '
  'could remove any other, including the organizer — which set '
  'households.organizer_member_id to NULL with no route to appoint a successor, '
  'permanently ending provisioning for that household. The self-removal clause '
  'is 0007''s and is unchanged.';
