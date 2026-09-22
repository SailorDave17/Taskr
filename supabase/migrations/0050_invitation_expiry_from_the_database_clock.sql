-- 0050 — an invitation's expiry is stamped by the database clock (#419).
--
-- WHAT IS WRONG TODAY. `0040` gave `expires_at` no default and granted it to
-- the client's insert, so `src/lib/invitations.js` computed it on the phone —
-- `new Date() + 7 days` — while `created_at` is the server's `now()`. The two
-- stamps on one row came from two clocks, and `invitations_expires_after_creation`
-- (`expires_at > created_at`) is the only thing comparing them. So:
--
--   * a phone a few days behind silently shortened the seven days;
--   * a phone more than seven days behind broke that check, and the organizer
--     read a raw constraint message through the error strip;
--   * a phone ahead lengthened the code past what the card and
--     `invitationShareText` promise.
--
-- *Measured on the live project 2026-09-21*, read-only, before this file: all
-- 6 invitations ever minted are off 168 hours — by -238 ms to +1,699 ms. The
-- negatives are the request's own latency (the phone read its clock before the
-- insert arrived) and the positive one is a phone running ahead. Small in
-- practice, and a promise stated to the organizer in days that no row keeps
-- exactly.
--
-- THE ROUTE, and #419 AC 1 asks this file to argue for it. The two offered were
-- a column default with `expires_at` dropped from the client insert grant, or a
-- `security definer` mint function. The default is taken:
--
--   * It is how `created_at` is already stamped, so both stamps come from one
--     clock — and `now()` is the TRANSACTION's start, so both defaults on one
--     insert read the same instant and the difference is the interval exactly,
--     not the interval plus however long the insert took.
--   * The mint stays an ordinary insert under `0040`'s four policies. A definer
--     function bypasses row-level security and would have to re-implement
--     `invitations_insert_organizer` — the organizer check AND the pin to the
--     caller's own member row — in its body, a second copy of the one rule that
--     decides who may issue a credential.
--   * It is additive, which is what made the owner's sequencing possible (next).
--
-- WHY TWO FILES. Owner decision at #419's pickup, 2026-09-21, at a clickable
-- question: this file adds the default and `0051` withdraws the column from the
-- client's insert grant. Minting is live in production, and the bundle there
-- still sends `expires_at` — so a single file revoking the grant would refuse
-- every mint from that bundle (`permission denied for table invitations`)
-- until the promotion reached each device, and the new bundle without this
-- default would fail `not null` in the other order. This file is safe under
-- BOTH bundles: the old one's value is still accepted, the new one's omission
-- is filled here. So it is applied first, before the promotion; `0051` after.
--
-- 168 HOURS, NOT '7 days'. The client's old arithmetic was exactly seven
-- 24-hour days, and an interval's DAY field is calendar days in the session's
-- time zone: across a daylight-saving change, `interval '7 days'` is 167 or 169
-- hours under a session zone that observes one. The live session is UTC today
-- (measured above: no role- or database-level `TimeZone` setting), and nothing
-- here should depend on that staying true — a session's zone is a setting of
-- the connection, not a property of the row. An interval whose whole length is
-- in its TIME field is the same number of seconds under every zone. `invitationExpiry.pglite.test.js` holds this
-- interval equal to `INVITATION_LIFETIME_DAYS * 24` hours — the constant the
-- card and the share message quote — so the promise and the stored expiry
-- cannot drift apart (AC 3).
--
-- Re-runnable: `set default` and `comment on` are idempotent by nature. Re-
-- pasting `0040` after this file does not undo it — `create table if not
-- exists` skips the whole statement, default and all — though it DOES undo
-- `0051`; see that file. No grant, no policy, no function: `check:live` and
-- `probe:live-grants` read the same on both sides, and the instrument is
-- `pg_get_expr` on the column's default, absent before and present after
-- (docs/access-model.md, #419).

alter table public.invitations
  alter column expires_at set default (now() + interval '168 hours');

comment on column public.invitations.expires_at is
  'When the code stops working: the database''s now() plus 168 hours, set by '
  'the column default and never by the client (story #419) - seven 24-hour '
  'days, the same number of seconds under every session time zone. '
  'INVITATION_LIFETIME_DAYS in src/lib/invitations.js is what the card and the '
  'share message quote, and a pglite test holds the two equal.';
