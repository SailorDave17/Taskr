-- 0008 — the grant the provisioning function needs, and why it was missing
--
-- Story #87. `0007` says, in its own words, that `members.claimed_by` is
-- "written only by the provisioning function running as service_role" — and
-- then grants `service_role` nothing. The function could not do the one thing
-- the column exists for.
--
-- WHY NOBODY NOTICED, WHICH IS THE PART WORTH KEEPING
--
-- On the HOSTED project this appears to work, because a Supabase project's
-- default privileges historically granted `anon`, `authenticated` and
-- `service_role` full table rights on anything created in `public`, and RLS was
-- what did the restricting. Newer stacks tightened that default: measured
-- 2026-08-13 on `supabase start`, the default ACL for tables created by
-- `postgres` in `public` is
--
--     anon=Dxtm  authenticated=Dxtm  service_role=Dxtm
--
-- which is TRUNCATE, REFERENCES, TRIGGER and MAINTAIN — no SELECT, INSERT,
-- UPDATE or DELETE. So every privilege this schema actually relies on must be
-- granted by a migration, and the ones that were never written down have been
-- riding on an inherited default that a rebuilt project does not get.
--
-- The pglite suite cannot see this at all: it applies these files to a plain
-- Postgres that has no `anon`, `authenticated` or `service_role` to grant to.
-- A harness that builds its own environment cannot tell you the environment is
-- wrong — which is why this was found by running the function and not by 545
-- green tests.
--
-- SCOPE: this file grants ONLY what the provisioning function needs. The
-- separate, larger gap — `public.households` has no SELECT grant for
-- `authenticated` in ANY migration, so `currentHousehold()` fails outright on a
-- database built from these files — is deliberately NOT fixed here. It predates
-- #87, it breaks the app rather than this function, and it deserves its own
-- story rather than riding in on one. It is filed separately.
--
-- Re-runnable: `grant` is idempotent, so a re-paste is a no-op.

-- ---------------------------------------------------------------------------
-- The narrowest surface that lets the Edge Function do its job
-- ---------------------------------------------------------------------------
--
-- Column-scoped rather than `grant update on public.members`, for the same
-- reason every client grant in 0002/0005/0007 is column-scoped: a bare table
-- grant would let a compromised function rewrite `weekly_minutes`,
-- `display_name` or `household_id`, and `household_id` is the column that
-- decides which household a person belongs to.
--
-- `service_role` bypasses RLS but NOT column grants — the two are separate
-- mechanisms, and that is exactly why this file is needed at all.

grant select (id, household_id, display_name, claimed_by, email)
  on public.members to service_role;

grant update (claimed_by)
  on public.members to service_role;

comment on column public.members.claimed_by is
  'the auth user this person signs in as. Written only by the provisioning '
  'Edge Function running as service_role (#87), which 0008 grants the column '
  'update for; absent from every client grant on purpose.';
