-- 0051 — the client no longer writes an invitation's expiry (#419).
--
-- APPLY ORDER: AFTER the `develop -> release` promotion that carries #419's
-- client, never before it. Owner decision at #419's pickup, 2026-09-21: `0050`
-- added the database default and is applied first; this file is the other
-- half. The bundle in production until that promotion still sends
-- `expires_at`, and once this file lands every one of its mints is refused at
-- the privilege layer — `permission denied for table invitations` — before any
-- policy is read. So the order is 0050, promote, then this.
--
-- WHAT IT DOES. `0040` granted insert on four columns — `household_id`,
-- `token_hash`, `created_by_member_id`, `expires_at` — and this file re-states
-- the client's whole surface on the table with the last one gone. After it, a
-- client cannot choose an invitation's expiry at all: a statement naming the
-- column is refused, and one omitting it gets `0050`'s default. That is AC 1's
-- "the client no longer sends it" enforced by the database rather than by the
-- one module that currently happens not to.
--
-- `0040`'s FORM, whole: revoke first, naming `authenticated`, `anon` and
-- `public` (`0036`'s three-role form), then grant by name. NOT `revoke insert
-- (expires_at)`: a narrow revoke is `0013`'s defect, since it leaves standing
-- whatever it did not name, and the complete re-grant below is the surface this
-- file claims rather than a delta that is only right against `0040`'s exact
-- result. `revoke all` on a table revokes its column privileges too, so the
-- statement clears `0040`'s by-column grants before these replace them.
--
-- SELECT and UPDATE are `0040`'s lists unchanged — nine columns readable,
-- `withdrawn_at` the one updatable — and INSERT is three. `created_at` and
-- `expires_at` are now both absent from every client write: the two clocks on
-- the row are the database's.
--
-- `service_role` is untouched, as `0040` left it: no Edge Function touches this
-- table, and the platform's inherited `arwdDxtm` on every table in `public` is a
-- fact about the project, read by `probe:live-grants`, not a statement this
-- file makes.
--
-- WHAT EACH INSTRUMENT SEES. `check:live` reads the same on both sides — it
-- only reads, and the select grant does not move. `probe:live-grants` carries
-- the row for exactly this: `invitations.expires_at` expected `r`, RED as `ar`
-- until this file is applied. The read-only catalog query in
-- `docs/access-model.md`'s #419 entry reads `has_column_privilege` for the
-- insert on both sides, with `household_id` (granted both sides) and
-- `created_at` (granted neither) as its two controls.
--
-- Re-runnable: revokes and grants are idempotent by nature. THE RE-PASTE
-- HAZARD: re-pasting `0040` after this file restores `expires_at` to the
-- client's insert grant, because `0040`'s revoke-then-grant is exactly this
-- file's shape with the fourth column in it. `0050`'s default survives that
-- re-paste; this file does not. Re-paste this one after it.
-- `invitationExpiry.pglite.test.js` asserts the hazard in both directions.

revoke all on public.invitations from authenticated, anon, public;

grant select (
  id, household_id, token_hash, created_by_member_id, created_at,
  expires_at, withdrawn_at, redeemed_at, redeemed_by_member_id
) on public.invitations to authenticated;

-- Three columns. `expires_at` left with #419; `created_at`, `id` and every
-- stamp the database owns were never here.
grant insert (household_id, token_hash, created_by_member_id)
  on public.invitations to authenticated;

grant update (withdrawn_at) on public.invitations to authenticated;
