-- The tables a phone listens to — story #342.
--
-- Nothing in this app refreshed on its own until #342: `App.jsx` re-read after
-- this device's own writes and at boot, and a second phone saw another phone's
-- work only after a reload. The client now holds one Supabase Realtime channel
-- per household, subscribed to `postgres_changes` on the tables it reads, and
-- Realtime publishes a change only for a table in the `supabase_realtime`
-- publication. This file puts them there. Without it the client's channel
-- joins are REFUSED ("Unable to subscribe to changes with given parameters"),
-- which is exactly what `npm run check:live` now probes, one row per table.
--
-- ===========================================================================
-- WHICH TABLES, AND WHERE THE LIST COMES FROM
-- ===========================================================================
--
-- Every table the client reads (`LIVE_SCHEMA` in `src/lib/liveSchema.js`)
-- except `member_split_seen`, which is self-scoped — what THIS member was last
-- shown, readable by nobody else — and is written by the re-read itself, so
-- watching it would turn every read into one more. The JS side derives the
-- same list (`WATCHED_TABLE_NAMES` in `src/lib/realtime.js`), and
-- `src/test/realtime.pglite.test.js` compares this publication against it in
-- both directions, so the two cannot drift. #342 was filed naming
-- `chore_completions` and `chore_assignments`; neither exists — completion and
-- assignment are columns on `chores` — and a hand-copied list would have
-- carried the error into production.
--
-- ===========================================================================
-- WHAT THE PUBLICATION DOES AND DOES NOT PROTECT
-- ===========================================================================
--
-- Realtime evaluates each table's row-level security policies per subscriber
-- for every INSERT and UPDATE, so a member receives only rows they could
-- `select` — the same rows a reload would show them — and a channel filtered
-- to the wrong household is a wasted message rather than a leak. DELETEs are
-- different, and this is the platform's rule rather than a choice made here:
-- there is no row left to check a policy against, so no policy is applied, and
-- by default the old record carries ONLY the primary key. Nothing here sets
-- `replica identity full` — that would send a deleted row's every column to
-- any subscriber with no policy in the way — so what a delete broadcasts is an
-- id, to every authenticated subscriber of that table, and what a phone does
-- with it is re-read through the policies it already has. `docs/access-model.md`
-- records this beside the rest of the read model, because a subscription is a
-- read path the document did not describe before #342.
--
-- Every table here has a primary key, which is the replica identity an UPDATE
-- or DELETE needs to be published at all.
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- `alter publication ... add table` REFUSES a table already in the publication
-- (42710, "relation is already member of publication"), so a bare list of
-- those statements would fail on the re-paste that `0001`'s header says is the
-- normal path. Each table is added only if `pg_publication_tables` does not
-- already list it — measured against pglite: a second run adds nothing and
-- raises nothing. The publication itself is created only if it is missing:
-- every Supabase project has it, pglite does not, and a project whose
-- publication was created `for all tables` already lists every table and this
-- file then adds none — which is the right answer there too.

do $$
declare
  watched text[] := array[
    'households',
    'members',
    'chores',
    'member_capacity',
    'chore_exclusions',
    'calendar_connections',
    'chore_repeat_exceptions',
    'calendar_busy',
    'shopping_lists',
    'shopping_runs',
    'shopping_items'
  ];
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array watched loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

comment on publication supabase_realtime is
  'Realtime publication — 0037 (#342) added the eleven tables the client reads and watches; '
  'member_split_seen is deliberately absent (self-scoped, written by the re-read itself). '
  'The list is derived from src/lib/realtime.js WATCHED_TABLE_NAMES and asserted by '
  'src/test/realtime.pglite.test.js; edit both or neither.';
