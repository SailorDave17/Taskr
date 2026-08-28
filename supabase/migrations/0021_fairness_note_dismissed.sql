-- The fairness note's dismissal — story #59.
--
-- The split surface now states, in one line, that its number counts time spent
-- doing work and does not count noticing, planning or remembering it (the
-- charter's ambition 4: the invisible half is at least acknowledged). #59 AC 3
-- says a dismissed statement must not reappear on every open, and WHERE that
-- dismissal lives was an owner decision at pickup (2026-08-28): PER MEMBER, on
-- the server — so it follows the person across phones and reinstalls, the same
-- property every other durable fact here has. Rejected: device-local (free, but
-- a reinstall re-opens an argument the member already closed) and per-household
-- (one member's dismissal would hide the statement from members who never saw
-- it).
--
-- One column on `member_split_seen`, not a new table: the seen-marker is
-- already the per-member record of "what has this member been shown about the
-- split", and this is exactly that kind of fact. The row is created by the
-- client's ordinary seen-marker upsert on the member's first look, which is
-- also why the statement is on screen before any dismissal could be written.
--
-- A BOOLEAN, not a timestamptz, on purpose. The app asks one question — has
-- this member dismissed it? — and a timestamp here could only be written from
-- the phone's clock, because a PostgREST update payload cannot say `now()`.
-- This schema's rule is that the server owns the clock (#35, #53); a column
-- that cannot honour that rule does not get the type that pretends to.
--
-- NO new policies: 0020's three self-scoped policies already gate every read
-- and write of this row to the member who owns it, and a dismissal is
-- self-scoped for the same reason the seen-marker is — another phone must not
-- be able to close a statement this member has not read.
--
-- NO insert grant for the column: the client's only insert is the seen-marker
-- upsert, which does not carry it, and the default covers the first write. The
-- update grant is the dismissal's whole write path.
--
-- Re-runnable: `add column if not exists`, and grants are idempotent. One
-- ORDERING hazard, stated rather than discovered: re-pasting 0020 AFTER this
-- file strips these column grants — its `revoke all` takes column-level grants
-- with it and its re-grant names only its own three columns. If 0020 is ever
-- re-applied, re-apply this file after it.

alter table public.member_split_seen
  add column if not exists fairness_note_dismissed boolean not null default false;

grant select (fairness_note_dismissed)
  on public.member_split_seen to authenticated;

grant update (fairness_note_dismissed)
  on public.member_split_seen to authenticated;
