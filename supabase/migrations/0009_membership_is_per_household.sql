-- 0009 — membership is per household, and the two indexes that said otherwise
--
-- Story #127. Found by RUNNING `src/test/rls.integration.test.js` for the first
-- time. It could not get past setup: one seeded account creating two households
-- failed on `members_claimed_by_key`, which is not a fact about the suite.
--
-- WHAT THE INDEX MEANT, AND WHEN IT STOPPED MEANING IT
--
-- 0001 created it, with its reason stated on the line above:
--
--     -- One device acts as at most one person, so "who did this" is never
--     -- ambiguous.
--     create unique index if not exists members_claimed_by_key
--       on public.members (claimed_by) where claimed_by is not null;
--
-- That was correct. Under device auth `claimed_by` held "which device session
-- is currently acting as this person" — 0001 says so in as many words — and one
-- phone standing in for two people at once is exactly the ambiguity worth
-- forbidding.
--
-- 0007 re-pointed `claimed_by` at a PERSON'S STABLE AUTH IDENTITY. The index was
-- not revisited; 0007's own header cites it approvingly on the way past —
-- "already carries a unique index" — as a convenience it inherits. But the
-- subject changed underneath it, and a global unique index on an identity means
-- something entirely different from a global unique index on a session: since
-- 0007, one PERSON may be a member of at most one household, permanently, across
-- the whole database. Nobody decided that. It is a product constraint that
-- arrived as a side effect of a migration whose stated scope was "only identity,
-- no data migration of history".
--
-- The rule the index was written to protect is untouched by this file: within a
-- household, one auth user still claims at most one member row, so "who did
-- this" stays unambiguous. What goes away is the accidental reach ACROSS
-- households.
--
-- WHY `members_email_key` HAS TO MOVE WITH IT, WHICH IS NOT OBVIOUS
--
-- 0007 added a second global unique index, on `lower(email)`, and its stated
-- reason is different and still true:
--
--     -- Unique across the table rather than per household: it maps 1:1 to a
--     -- Supabase auth user, and auth emails are global.
--
-- Auth emails ARE global, and that stays true — in `auth.users`, which is where
-- it is enforced by the platform. The mistake is enforcing it a second time on
-- `public.members`, because after 0007 `members` is no longer one row per
-- person: it is one row per person PER HOUSEHOLD. `create_household` writes the
-- organizer's address from `auth.users` into every member row it makes, so the
-- same person creating a second household inserts their address a second time.
--
-- MEASURED, not reasoned — pglite, three arms, 2026-08-21:
--
--   A. as shipped                     household 1 OK, household 2 FAIL
--                                     -> members_claimed_by_key
--   B. rescope claimed_by only        household 1 OK, household 2 FAIL
--                                     -> members_email_key
--   C. rescope both                   household 1 OK, household 2 OK
--
-- So B is the trap this file exists to avoid: it looks like the fix, passes
-- inspection, and moves the failure one index to the right.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--
-- It does not make the app support a person in two households; it stops the
-- SCHEMA forbidding it. One path is known not to work yet and is filed rather
-- than fixed here: `provision-member` calls `auth.admin.createUser` with the
-- member's real address, which fails when that auth user already exists — so
-- provisioning a REAL-EMAIL person into a second household is refused with
-- "Could not create that sign-in". A member with no address is unaffected: the
-- synthetic form derives from `members.id`, which differs per row by
-- construction, so it is unique per household for free.
--
-- SAFE ON EXISTING DATA. Both new indexes are strictly WEAKER than the ones they
-- replace — every row set satisfying a global uniqueness constraint satisfies
-- the per-household one — so no live row can conflict with them and the create
-- cannot fail on data.
--
-- Re-runnable: `drop index if exists` then `create unique index if not exists`,
-- so a re-paste is a no-op.

-- ---------------------------------------------------------------------------
-- 1. One person, one member row — per household rather than per database
-- ---------------------------------------------------------------------------

drop index if exists public.members_claimed_by_key;

create unique index if not exists members_household_claimed_by_key
  on public.members (household_id, claimed_by) where claimed_by is not null;

-- ---------------------------------------------------------------------------
-- 2. One address, one member row — per household, for the same reason
-- ---------------------------------------------------------------------------

drop index if exists public.members_email_key;

create unique index if not exists members_household_email_key
  on public.members (household_id, lower(email)) where email is not null;

comment on column public.members.email is
  'A real address where the member has one, NULL otherwise. Null means the '
  'member signs in with a synthetic <id>@taskr.invalid address and a PIN; '
  'non-null means a real address and a longer secret. Story #62. Unique per '
  'HOUSEHOLD since 0009 (#127), not per database: after 0007 a person has one '
  'member row per household they belong to, and each carries their address.';
