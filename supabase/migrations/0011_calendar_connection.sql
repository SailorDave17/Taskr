-- Connecting a Google Calendar — story #95.
--
-- The first credential this schema holds that belongs to somebody ELSE. Every
-- secret before it — the `service_role` key, the anon key — is Taskr's own and
-- lives outside the database entirely. A Google refresh token is a bearer
-- credential for a person's calendar, it does not expire on its own, and it is
-- stored here because there is nowhere else for it: the exchange happens in an
-- Edge Function and the next slices (#96, #98) have to use it again later
-- without asking the member to consent a second time.
--
-- ===========================================================================
-- WHY THIS IS TWO TABLES AND NOT ONE WITH A NARROW COLUMN GRANT
-- ===========================================================================
--
-- Every other table here is protected by withholding COLUMNS: `members` grants
-- select on a list that omits `household_id`, and `select('*')` fails loudly as
-- a result. That device is deliberately NOT used for the refresh token, and the
-- reason is what a mistake costs.
--
-- A column grant is a list somebody edits. Adding a column to the wrong `grant
-- select (...)` line is a one-word diff that reads exactly like the twenty other
-- one-word diffs in these files, and the failure is silent: the app keeps
-- working and the token becomes readable by every signed-in member of the
-- household. So the token lives in a table with NO client grant of any kind and
-- NO policy for `authenticated` — a table no client can name, where the
-- equivalent mistake is not a word but a whole new grant statement, which is a
-- thing a reader argues with rather than skims past.
--
-- `calendar_connections` is the half the screen needs: WHO is connected and to
-- what scope, and nothing that could be replayed against Google. #95 AC 5 asks
-- for exactly that split — a connection-status flag the client may read, while
-- the client has no SELECT on the token table.
--
-- Owner decision at pickup, 2026-08-24, over the alternative of one flag column
-- on `members`: two tables keep the calendar concern out of the roster and leave
-- the `members` grants untouched, at the cost of one more read on refresh.
--
-- ===========================================================================
-- NO `provider` COLUMN
-- ===========================================================================
--
-- One would be free to add and reads as foresight. It is not: it would be a
-- one-value check constraint carried by every row, and every consumer would have
-- to filter on it to mean anything. Google is the only provider in the charter
-- and in every filed calendar story (#96–#106). A second provider is a
-- migration, which is what migrations are for.
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- Applied by a human pasting into the Supabase SQL editor, so a re-paste after a
-- partial failure is the normal path rather than an edge case — 0010's device
-- throughout: `create table if not exists` with constraints declared INLINE (on
-- a re-run the whole statement is skipped and inline constraints go with it),
-- `drop policy if exists` before the policy, and grants, which are idempotent by
-- nature.

-- ---------------------------------------------------------------------------
-- 1. The status the screen reads
-- ---------------------------------------------------------------------------

create table if not exists public.calendar_connections (
  id           uuid primary key default extensions.gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  member_id    uuid not null,

  -- What Google actually GRANTED, as the space-separated string it returns —
  -- not what was asked for. #95 AC 3 asks only for the freebusy scope, and
  -- #101's import will ask for `calendar.readonly` on top through incremental
  -- consent. A later slice has to know which of those it is holding, and the
  -- honest source for that is the token response rather than the request.
  scope        text not null,

  connected_at timestamptz not null default now(),

  -- One connection per person. Re-connecting is a correction of the same fact
  -- rather than a second fact, so the Edge Function upserts on this key and the
  -- old refresh token is replaced instead of accumulated. An accumulating token
  -- table is a pile of live credentials nobody is tracking.
  constraint calendar_connections_one_per_member unique (member_id),

  -- COMPOSITE, for 0010's reason one table over: the member and the household
  -- this row claims must be the same household, so a row pairing one family's
  -- person with another family's id cannot exist at all. The cascade means a
  -- removed member takes their connection with them — and, through the token
  -- table's own cascade below, their stored credential too.
  constraint calendar_connections_member_in_household
    foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade
);

comment on table public.calendar_connections is
  'Who has connected a Google Calendar, and with what scope. Deliberately holds '
  'nothing that could be replayed against Google — the refresh token is in '
  'calendar_tokens, which no client can read. Story #95.';

-- ---------------------------------------------------------------------------
-- 2. The credential
-- ---------------------------------------------------------------------------

create table if not exists public.calendar_tokens (
  id            uuid primary key default extensions.gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  member_id     uuid not null,

  -- Long-lived and not self-expiring: Google issues this once, at first consent,
  -- and it keeps working until the member revokes it or #99 disconnects them.
  -- Treat a leak of this column as a leak of the calendar itself.
  refresh_token text not null,

  scope         text not null,
  created_at    timestamptz not null default now(),

  constraint calendar_tokens_one_per_member unique (member_id),

  constraint calendar_tokens_member_in_household
    foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade
);

comment on table public.calendar_tokens is
  'A member''s Google refresh token. No client grant and no policy for '
  '`authenticated` — only the Edge Function, as service_role, ever reads or '
  'writes it. Story #95.';

-- ---------------------------------------------------------------------------
-- 3. Row-level security — which ROWS
--
-- `calendar_connections` follows every other table here: the household is the
-- trust boundary, and inside it the roster is visible to everyone. Seeing that a
-- housemate has connected a calendar is the same class of fact as seeing their
-- weekly minutes, which the roster has always shown.
--
-- There is deliberately no INSERT, UPDATE or DELETE policy on EITHER table, and
-- no grant to match. Both are written only by the Edge Function running as
-- `service_role`, which bypasses row-level security — so a policy for it would
-- be inert, and a policy for `authenticated` would be a second way in for a
-- write that must have exactly one.
--
-- `calendar_tokens` has RLS enabled and NO policy at all. That is not belt and
-- braces on top of the absent grant: `enable row level security` with no policy
-- denies every row to every non-bypassing role, so if a future migration grants
-- select here by accident the rows are still not reachable. Two independent
-- mistakes would be needed rather than one.
-- ---------------------------------------------------------------------------

alter table public.calendar_connections enable row level security;
alter table public.calendar_tokens      enable row level security;

drop policy if exists calendar_connections_select_same_household on public.calendar_connections;
create policy calendar_connections_select_same_household
  on public.calendar_connections for select to authenticated
  using (household_id in (select public.current_household_ids()));

-- ---------------------------------------------------------------------------
-- 4. Privileges — which COLUMNS, and for whom
--
-- `service_role` is granted EXPLICITLY, and that is not ceremony. It bypasses
-- row-level security; it does NOT bypass grants. On a current Supabase project a
-- freshly created table gives every Data API role `Dxtm` — truncate, references,
-- trigger, maintain — and nothing else: no select, no insert, no update, no
-- delete. An Edge Function holding the service_role key would be refused 42501
-- on its own table.
--
-- This comment used to add that the local pglite harness DISAGREED, being
-- `alter default privileges ... grant all` and "deliberately more permissive
-- than the platform", so that the grant below was vacuous there and load-bearing
-- only in production. That expired with #91, which narrowed the harness to the
-- platform's real default (src/test/support/pgliteSupabase.js) — an expired
-- sentence, not a wrong one, corrected under #334. With no DML in the default,
-- an explicit grant is the ONLY thing that can put DML on a table, so the grant
-- is proven locally as well: *measured 2026-09-05 (#334)*, deleting the two
-- service_role grants below reddens `and service_role reaches only what the
-- Edge Functions need` in src/test/grants.pglite.test.js — predicted 1, actual
-- 1. `0030`'s comment says the same of its own grant, on its own measurement;
-- neither borrows the other's. Which direction a stub can prove is written out
-- once, in that test file's header.
--
-- The revokes come first and name `anon` alongside `authenticated` for 0002's
-- reason, restated by 0003, 0005 and 0010: no policy above targets `anon`, so it
-- cannot reach a row today — but that is one `to anon` away from being false,
-- and a privilege that has to STAY correct is worse than one that is absent.
-- `public` is named as well on the token table, because a privilege held by
-- `public` is held by every role that will ever exist. Since the same #91
-- change they no longer hold the client's doors shut on their own — the default
-- already grants no DML — so they are the house convention rather than the
-- refusal: *measured 2026-09-05 (#334)*, deleting both reddens 3 of 23 in
-- src/test/calendar.pglite.test.js (the two table-level ACL assertions and the
-- ordering test), not every refusal in that file.
-- ---------------------------------------------------------------------------

revoke all on public.calendar_connections from authenticated, anon;
revoke all on public.calendar_tokens      from authenticated, anon, public;

-- `household_id` is absent, matching 0003, 0005 and 0010: it is written by the
-- function and never read back, because row-level security already guarantees
-- every row this device can see belongs to its household. The side effect is the
-- one that matters — withholding a column is what makes `select('*')` FAIL
-- OUTRIGHT on this table, so a forgotten column list is a loud error rather than
-- a quiet superset.
grant select (id, member_id, scope, connected_at)
  on public.calendar_connections to authenticated;

grant select, insert, update, delete on public.calendar_connections to service_role;
grant select, insert, update, delete on public.calendar_tokens      to service_role;
