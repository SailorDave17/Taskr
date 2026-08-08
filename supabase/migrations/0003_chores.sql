-- Chores as minutes of work — story #34.
--
-- The second persisted data in the app, and the first that is not about people.
-- Taskr's whole thesis is that a chore is a quantity of TIME: `expected_minutes`
-- is not metadata on a to-do item, it is the unit the fairness calculation
-- divides. A chore without honest minutes is a chore the allocation cannot use.
--
-- ===========================================================================
-- The grant convention this migration sets, which #35, #36 and #37 inherit
-- ===========================================================================
--
-- 0002 established the shape and docs/access-model.md carries the reasoning:
-- row-level security decides WHICH ROWS and has nothing whatsoever to say about
-- WHICH COLUMNS, while Supabase's default privileges hand `authenticated` every
-- column of every new table in `public`. So a rule enforced only inside a
-- definer function is enforced only for clients that choose to call it.
--
-- Measured on this repo against the live project, 2026-08-06, before 0002:
--
--   claim_member RPC as device B      -> REFUSED: already claimed on another device
--   UPDATE members SET claimed_by=B   -> ALLOWED, 1 row changed, identity taken
--
-- Chores are the second persisted data and the argument is identical, so this
-- file revokes and re-grants per column from the first line rather than adding
-- it later.
--
-- THE CONVENTION, stated once here because three later stories depend on it:
-- each migration grants UPDATE only on the columns IT makes client-editable.
-- The grant set is additive by column, so no later story ever revokes a shipped
-- grant, and the "a client cannot write this" test always lives in the story
-- that introduces the withheld column. That is why `assigned_member_id`
-- (story #36) and `completed_at` (story #35) DO NOT EXIST in this file. Adding
-- the columns here and withholding the grants would look more complete and
-- would be worse: the test proving they cannot be written would sit in a story
-- that has no reason yet to write them.
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- This file is applied by a human pasting it into the Supabase SQL editor, and
-- a re-paste after a partial failure is the normal path rather than an edge
-- case — 0001 records a version of itself that failed on its second run. Every
-- policy below is therefore preceded by `drop policy if exists`, because
-- Postgres has no `create policy if not exists`. The table and its indexes use
-- `if not exists`, and the check constraints are declared INLINE rather than
-- through `alter table add constraint`, which has no idempotent form: on a
-- re-run the whole `create table` is skipped and the constraints come with it.

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

create table if not exists public.chores (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households (id) on delete cascade,

  title            text not null
    constraint chores_title_length check (length(btrim(title)) between 1 and 80),

  -- Minutes, as an integer, bounded at both ends. Zero is excluded on purpose:
  -- a chore costing no time cannot be allocated fairly against a budget of
  -- minutes, so it is a note rather than a chore. 1440 is one day; anything
  -- above it is a project being mistyped as a chore, and it would swamp every
  -- real capacity in the household.
  --
  -- The constraint is NAMED because the test asserts against the name. Postgres
  -- generates its own message text and that text is not a contract — asserting
  -- against it would make the test pass or fail on a Postgres version rather
  -- than on the rule.
  expected_minutes integer not null
    constraint chores_expected_minutes_range check (expected_minutes between 1 and 1440),

  -- A DATE, never text. The recurrence stories (#53, #54, #55) schedule against
  -- this column and cannot schedule against 'Monday' or 'daily'. The pglite
  -- suite asserts the type through information_schema rather than by inserting
  -- a date-shaped string, because a `text` column accepts one of those
  -- perfectly happily and the test would pass on the wrong schema.
  due_on           date not null,

  created_at       timestamptz not null default now()
);

create index if not exists chores_household_id_idx on public.chores (household_id);

-- Reading the week in due order is the query the UI actually makes.
create index if not exists chores_household_due_idx on public.chores (household_id, due_on);

-- ---------------------------------------------------------------------------
-- Row-level security — which rows
--
-- Same shape as `members` in 0001: a household is a trust boundary, and inside
-- it everyone maintains the list. A device that has not joined sees nothing at
-- all — not an empty household, nothing.
-- ---------------------------------------------------------------------------

alter table public.chores enable row level security;

drop policy if exists chores_select_same_household on public.chores;
create policy chores_select_same_household
  on public.chores for select
  to authenticated
  using (
    household_id in (
      select hd.household_id from public.household_devices hd
      where hd.auth_user_id = (select auth.uid())
    )
  );

drop policy if exists chores_insert_same_household on public.chores;
create policy chores_insert_same_household
  on public.chores for insert
  to authenticated
  with check (
    household_id in (
      select hd.household_id from public.household_devices hd
      where hd.auth_user_id = (select auth.uid())
    )
  );

drop policy if exists chores_update_same_household on public.chores;
create policy chores_update_same_household
  on public.chores for update
  to authenticated
  using (
    household_id in (
      select hd.household_id from public.household_devices hd
      where hd.auth_user_id = (select auth.uid())
    )
  )
  with check (
    household_id in (
      select hd.household_id from public.household_devices hd
      where hd.auth_user_id = (select auth.uid())
    )
  );

drop policy if exists chores_delete_same_household on public.chores;
create policy chores_delete_same_household
  on public.chores for delete
  to authenticated
  using (
    household_id in (
      select hd.household_id from public.household_devices hd
      where hd.auth_user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Column-level privileges — which columns
--
-- Without these the policies above are the only rule, and they are row-level.
-- `anon` is revoked alongside `authenticated` for the reason 0002 gives: no
-- policy here targets anon, so it cannot reach a row today, but that is one
-- `to anon` away from being false, and a privilege that has to STAY correct is
-- worse than one that is simply absent.
--
-- `anon` is revoked WHOLESALE, not column by column, and that is a correction
-- rather than a flourish. An earlier draft of this file revoked only select,
-- insert and update from both roles and defended the omission with "Postgres
-- has no column form of the delete privilege, so there is nothing to restrict".
-- That is a non-sequitur: the statement below is a TABLE-level revoke with no
-- column list, so `revoke delete` is perfectly expressible.
--
-- MEASURED against this repo's pglite harness (review of #34, 2026-08-08):
-- with the narrow revoke, `information_schema.table_privileges` returned
-- DELETE, REFERENCES, TRIGGER and TRUNCATE for `anon` on this table, while
-- `information_schema.column_privileges` returned only REFERENCES — so the
-- test that claimed to prove anon could not write was querying a catalog that
-- STRUCTURALLY CANNOT report the three privileges that mattered.
--
-- Neither is exploitable through the publishable key today: PostgREST emits
-- only SELECT/INSERT/UPDATE/DELETE and RPC, never TRUNCATE, and anon's DELETE
-- affects zero rows because no policy targets it. Both are latent, and the
-- comment above says exactly why latent is not good enough — one `to anon`
-- policy in #35, #36 or #49 turns the DELETE grant live, and the person adding
-- that policy will be thinking about rows, not about a privilege inherited from
-- a default four migrations ago.
--
-- DELETE stays granted to `authenticated`, which needs it for
-- `chores_delete_same_household`. That is why anon and authenticated are two
-- statements here rather than one.
-- ---------------------------------------------------------------------------

revoke all on public.chores from anon;

revoke select, insert, update on public.chores from authenticated;

-- `household_id` is deliberately NOT readable, and this is the column that makes
-- the whole shape provable rather than decorative.
--
-- Measured while writing this file: with every column granted, `select *`
-- SUCCEEDS. A column grant only refuses the wildcard when something is actually
-- withheld, so a table whose every column is readable has the revoke/grant
-- ceremony and none of its effect — it would have shipped looking exactly like
-- 0002 and behaving like 0001.
--
-- Withholding this one is not a device to make a test pass. A client cannot
-- learn anything from it: row-level security guarantees every chore it can see
-- already belongs to its own household, so the value is a constant it can
-- already name. It is written on INSERT (the grant below allows that) and the
-- with-check policy is what decides whether the value is permitted — the grant
-- says which columns, the policy says which values.
--
-- One consequence worth knowing before #36 or #49 is written: a column with no
-- select grant cannot appear in a WHERE or an ORDER BY either, not just in the
-- projection. That is fine here — the client never filters by household, RLS
-- does — but a later story that wants to group by it will have to grant it
-- rather than wonder why the query is refused.
--
-- The precedent for #35 and #36: grant select only on what the client renders.
grant select (id, title, expected_minutes, due_on, created_at)
  on public.chores to authenticated;

-- A client may describe a chore. `household_id` is here because the insert has
-- to name one, and the with-check policy above is what stops it naming somebody
-- else's — the grant says which columns, the policy says which values.
grant insert (household_id, title, expected_minutes, due_on)
  on public.chores to authenticated;

-- Editing a chore is editing its description. `household_id` is NOT in this set:
-- a chore cannot be moved between households, and no story wants it to be.
grant update (title, expected_minutes, due_on)
  on public.chores to authenticated;
