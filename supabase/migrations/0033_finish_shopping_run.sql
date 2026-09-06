-- Finishing a shopping run — story #354.
--
-- One transaction that closes a list's open run and opens the next one with
-- every unbought item copied forward. The hardest function in epic #349, and
-- kept out of `0032` on purpose so the schema could land at its own size
-- (`0032`'s header says so). Nothing renders this yet: #357 is the confirmed
-- tap that calls it, and #356 is the two-phone proof against the live project
-- that pglite cannot run.
--
-- The file is `0033`, not the `0032` the story names: `0031` (#97) landed the
-- day the epic was groomed, `0032` became the schema, and #352's comment told
-- this story the shift would follow it here.
--
-- ===========================================================================
-- Why the argument is the RUN and not the list
-- ===========================================================================
--
-- Two phones in one household, both screens showing the same open run, both
-- thumbs pressing Done. With `list_id` as the argument the second call would
-- resolve "the list's open run" AFRESH — which by then is the run the FIRST
-- call just opened — close it, and carry every item forward a second time: two
-- closed runs, a third open one, every unbought item duplicated. With `run_id`
-- the second call names the run its screen was showing, finds it already
-- closed, and raises `run already closed` having written nothing. A stale
-- screen can never finish a run it has not seen.
--
-- ===========================================================================
-- Why the whole thing is one statement sequence under `for update`
-- ===========================================================================
--
-- The close, the new run and the carried items are three writes, and the
-- property the epic protects — "exactly one next list, nothing lost" — is a
-- property of all three together. So:
--
--   1. `select … for update` locks the run row. A second caller on the same
--      run WAITS here until the first commits, then re-reads the row and sees
--      the close (READ COMMITTED re-checks the WHERE clause on the row's new
--      version, so the row is still found, now with `closed_at` set).
--   2. The close and the two inserts run inside the same function call, which
--      is one transaction: either all three land or none does.
--   3. `shopping_runs_one_open_per_list` (`0032`) is the constraint behind the
--      lock. If any path ever reaches the second insert while the list already
--      has an open run, Postgres refuses the insert and the whole call rolls
--      back — belt under the braces, and the one thing here that does not
--      depend on this function being the only closer.
--
-- pglite is single-connection, so the interleaving in step 1 cannot be
-- exercised there; the suite proves the sequential form (second call refused,
-- one open run, no item carried twice) and #356 proves the concurrent one on
-- the hosted project.
--
-- ===========================================================================
-- Why `0032`'s three item writers are REPLACED here, and the carry locks
-- ===========================================================================
--
-- Found by review before this file reached any project (#354's fan-out,
-- 2026-09-05): the lock above serialises a finish against another FINISH and
-- nothing else. `0032`'s `add_shopping_item`, `purchase_shopping_item` and
-- `unpurchase_shopping_item` read `shopping_runs.closed_at` with NO lock on
-- the run row, so a write that overlaps a finish passes the closed check on a
-- snapshot taken before the close and lands anyway:
--
--   * an ADD or an UN-PURCHASE overlapping a finish leaves an unbought item on
--     the just-closed run — never carried, never shown, "nothing lost" false;
--   * a PURCHASE overlapping a finish, in one of the two orderings, leaves the
--     item bought on the closed run AND copied unbought onto the next one, so
--     the household buys it twice.
--
-- Two changes close it, both belt-and-braces with each other:
--
--   a. The three item writers take `for key share` on the RUN ROW before they
--      read `closed_at`, and they take it FIRST — before the item lock. A key
--      share conflicts with a finish's `for update`, so a writer that arrives
--      while a finish is in flight waits, re-reads the close on a fresh
--      snapshot when the finish commits, and is refused with `run already
--      closed`; a writer that arrives FIRST holds the run until it commits, so
--      the finish's `for update` waits and its carry then sees the write. The
--      ORDER is load-bearing: the finish locks the run, then the items (below);
--      if a purchase locked the item first and the run second, the two would
--      wait on each other and Postgres would abort one with a deadlock. Every
--      writer here locks the run first, then its item — one order everywhere.
--   b. The carry's `insert … select` locks its source rows `for update`. A
--      purchase already holding an item makes the carry wait for it, and the
--      re-check on the fresh row version sees the stamp and skips the copy; a
--      delete already holding an item is skipped the same way rather than
--      referenced, which is what stood between a concurrent remove and a raw
--      `23503` aborting the whole finish.
--
-- What this does NOT close, stated rather than implied: a client `delete`
-- that arrives AFTER the carry has locked the item waits for the finish and
-- then proceeds against the original under a policy evaluated on its own
-- older snapshot — the closed run loses its record of the item while the copy
-- survives on the next run. The delete path is a policy (`0032`) and a policy
-- cannot lock the run, so that is filed as #368 under #349 rather than
-- reached from here. Sequential behaviour of the three writers is
-- unchanged and `shopping.pglite.test.js` holds it; the only observable of
-- the new clauses in a single connection is the catalog, which
-- `finish-shopping-run.pglite.test.js` reads.
--
-- ===========================================================================
-- What a carried item keeps (owner decision, 2026-09-05)
-- ===========================================================================
--
-- `name`, `note`, `added_by_member_id` and `added_at` are copied from the
-- original, `carried_from_item_id` points at it, and the purchase columns are
-- null. The finisher is the one member known NOT to have added the item, so
-- stamping them as the adder would be a lie the roster would then render;
-- keeping `added_at` keeps carried items at the top of the next run's unbought
-- order, which is where the household expects the thing it missed last time.
-- The original rows are NOT moved: they stay on the closed run as the record
-- of what that trip did not manage, which is what #359's past runs show.
--
-- `closed_at` and `opened_at` are the database clock's, as every stamp since
-- `0004`: the signature carries no timestamp, and a phone whose clock is
-- whatever it is cannot backdate a close.
--
-- ===========================================================================
-- Who may call it
-- ===========================================================================
--
-- Any member of the run's household (owner decision 2 on the epic: no
-- organizer gate anywhere in the feature). Membership is checked by the same
-- `current_household_ids()` every policy uses; the closer is resolved by
-- `acting_member(household)` from the caller, never named by them. A run in
-- another household is refused with the SAME sentence a nonexistent id gets,
-- so which of the two you hit is free information — `complete_chore`'s rule.
--
-- No grant on any table moves. `authenticated` still holds no insert and no
-- update on `shopping_runs` and no insert on `shopping_items`; this function
-- runs as its owner and is the only writer of `closed_at`,
-- `closed_by_member_id` and a rolled-forward item.
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- Applied by `npm run migrate:live` or a hand paste; a re-paste is the normal
-- path. `finish_shopping_run` is `create or replace` with a signature no
-- earlier file declares, so no overload is created; the three replaced
-- writers keep their `0032` signatures exactly, so each is a true replace and
-- PostgREST's argument-name resolution is untouched. `create or replace`
-- preserves the ACLs `0032` set, and this file re-issues no privilege
-- statement for them. Re-runnable against the schema this file was written
-- for, which is the only claim any migration here makes;
-- `finish-shopping-run.pglite.test.js` applies it twice to prove it. Note the
-- mirror hazard cairn records for `0004`/`0007`: re-pasting `0032` on top of
-- this file silently puts the three UNLOCKED bodies back. The suite asserts
-- that too, so the direction of the hazard is written down rather than
-- discovered.
--
-- A parameter named `run_id` beside a column named `run_id` on
-- `shopping_items` is ambiguous inside plpgsql, and Postgres refuses the
-- statement rather than guessing. Every column below is table-qualified and
-- the parameter is function-qualified (`finish_shopping_run.run_id`), the
-- `0032` discipline.

-- ---------------------------------------------------------------------------
-- 1. The function
-- ---------------------------------------------------------------------------

create or replace function public.finish_shopping_run(run_id uuid)
returns public.shopping_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target public.shopping_runs;
  finisher uuid;
  opened public.shopping_runs;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  -- The lock. Everything below happens while this row is held, so two calls
  -- on one run are serialised here and the second one reads the close the
  -- first one wrote. The run is locked FIRST, before any item — the one lock
  -- order every writer in this schema follows (header, section on `0032`'s
  -- writers).
  select r.* into target
  from public.shopping_runs r
  where r.id = finish_shopping_run.run_id
    and r.household_id in (select public.current_household_ids())
  for update of r;

  if not found then
    raise exception 'no such run in your household';
  end if;

  if target.closed_at is not null then
    raise exception 'run already closed';
  end if;

  -- Resolved once and used once, but named for the same reason `0029` names
  -- its completer: the value written is the caller's member row IN THIS
  -- HOUSEHOLD, and a member of two households must never be stamped with the
  -- other one's row.
  finisher := public.acting_member(target.household_id);

  update public.shopping_runs
     set closed_at = now(),
         closed_by_member_id = finisher
   where shopping_runs.id = target.id;

  -- The next run, for the same list and household. `opened_at` defaults to
  -- now(); the partial unique index refuses this insert if the list somehow
  -- still has an open run, and the refusal rolls back the close above.
  insert into public.shopping_runs (list_id, household_id)
  values (target.list_id, target.household_id)
  returning * into opened;

  -- Every unbought item, copied — never moved — onto the new run, keeping who
  -- added it and when, and pointing back at the row it came from. The source
  -- rows are locked `for update`: an item a purchase or a remove already holds
  -- makes this wait, and the re-check on the fresh row version then skips a
  -- row that is bought or gone rather than copying or referencing it.
  insert into public.shopping_items
    (run_id, household_id, name, note, added_by_member_id, added_at, carried_from_item_id)
  select opened.id,
         i.household_id,
         i.name,
         i.note,
         i.added_by_member_id,
         i.added_at,
         i.id
    from public.shopping_items i
   where i.run_id = target.id
     and i.purchased_at is null
     for update of i;

  return opened;
end;
$$;

comment on function public.finish_shopping_run(uuid) is
  'Close the named open run in the caller''s household and open the list''s '
  'next run in the same transaction, copying every unbought item forward with '
  'its adder, its added_at and carried_from_item_id, under a row lock so two '
  'phones finishing one run produce exactly one next run. Takes the RUN, not '
  'the list, so a stale screen cannot finish the fresh run. The only writer of '
  'closed_at and closed_by_member_id. Story #354.';

-- ---------------------------------------------------------------------------
-- 2. `0032`'s three item writers, replaced to lock the run first
--
-- Each body is `0032`'s with one change: the run row is read `for key share`
-- BEFORE the item is touched. Signatures, names, refusals and stamps are
-- unchanged; `shopping.pglite.test.js` still passes against them unedited.
-- ---------------------------------------------------------------------------

create or replace function public.add_shopping_item(run uuid, name text, note text)
returns public.shopping_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  item_name text := btrim(add_shopping_item.name);
  item_note text := nullif(btrim(add_shopping_item.note), '');
  target public.shopping_runs;
  made public.shopping_items;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  if item_name is null or item_name = '' then
    raise exception 'an item needs a name';
  end if;

  -- #354: `for key share of r`. A finish in flight holds this row `for
  -- update`, so this waits for it and then reads the close it wrote.
  select r.* into target
  from public.shopping_runs r
  where r.id = add_shopping_item.run
    and r.household_id in (select public.current_household_ids())
  for key share of r;

  if not found then
    raise exception 'no such run in your household';
  end if;

  if target.closed_at is not null then
    raise exception 'run already closed';
  end if;

  -- The adder and the time are the database's: no timestamp in the signature,
  -- and the member resolved from the caller, not named by them.
  insert into public.shopping_items (run_id, household_id, name, note, added_by_member_id, added_at)
  values (target.id, target.household_id, item_name, item_note,
          public.acting_member(target.household_id), now())
  returning * into made;

  return made;
end;
$$;

comment on function public.add_shopping_item(uuid, text, text) is
  'Add an item to an open run in the caller''s household, stamped with the '
  'caller''s member row and the database clock. The only writer of '
  'shopping_items rows other than #354''s rollover. Holds the run row for key '
  'share so an add cannot slip onto a run a finish is closing (#354). Story #352.';

-- Bought. The run is held first (key share) and the item second (`for
-- update`) — the schema's one lock order — so a finish and a tick on the same
-- run serialise instead of deadlocking, and two phones ticking one item keep
-- the FIRST stamp: the second waits on the item lock, re-reads the
-- now-purchased row, and is refused.
create or replace function public.purchase_shopping_item(item uuid)
returns public.shopping_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target public.shopping_items;
  run_closed_at timestamptz;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  -- Which run, read WITHOUT a lock on the item: the item is locked only after
  -- the run is held, so the lock order matches the finish's.
  select i.* into target
  from public.shopping_items i
  where i.id = purchase_shopping_item.item
    and i.household_id in (select public.current_household_ids());

  if not found then
    raise exception 'no such item in your household';
  end if;

  -- #354: the run first, `for key share`. Waits out a finish in flight, then
  -- reads the close it wrote.
  select r.closed_at into run_closed_at
  from public.shopping_runs r
  where r.id = target.run_id
  for key share of r;

  if run_closed_at is not null then
    raise exception 'run already closed';
  end if;

  -- Now the item, `for update`, re-read under the lock so a tick that landed
  -- between the first read and this one is seen.
  select i.* into target
  from public.shopping_items i
  where i.id = purchase_shopping_item.item
  for update of i;

  if target.purchased_at is not null then
    raise exception 'item already bought';
  end if;

  update public.shopping_items
     set purchased_at = now(),
         purchased_by_member_id = public.acting_member(target.household_id)
   where id = target.id
  returning * into target;

  return target;
end;
$$;

comment on function public.purchase_shopping_item(uuid) is
  'Mark an item bought, stamped with the caller''s member row and the database '
  'clock, under a row lock so the first of two simultaneous ticks wins and the '
  'second is refused rather than re-stamping. Holds the run row for key share '
  'first so a tick cannot race a finish (#354). Story #352.';

-- Not bought after all. Same lock order as the purchase.
create or replace function public.unpurchase_shopping_item(item uuid)
returns public.shopping_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target public.shopping_items;
  run_closed_at timestamptz;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  select i.* into target
  from public.shopping_items i
  where i.id = unpurchase_shopping_item.item
    and i.household_id in (select public.current_household_ids());

  if not found then
    raise exception 'no such item in your household';
  end if;

  -- #354: the run first, `for key share`.
  select r.closed_at into run_closed_at
  from public.shopping_runs r
  where r.id = target.run_id
  for key share of r;

  if run_closed_at is not null then
    raise exception 'run already closed';
  end if;

  select i.* into target
  from public.shopping_items i
  where i.id = unpurchase_shopping_item.item
  for update of i;

  update public.shopping_items
     set purchased_at = null,
         purchased_by_member_id = null
   where id = target.id
  returning * into target;

  return target;
end;
$$;

comment on function public.unpurchase_shopping_item(uuid) is
  'Take back a purchase: purchased_at and purchased_by_member_id return to '
  'null and nothing else on the row moves. Any household member may. Holds '
  'the run row for key share first so an un-tick cannot race a finish (#354). '
  'Story #352.';

-- ---------------------------------------------------------------------------
-- 3. Privileges
--
-- `0010`'s shape, as `0032` has it: revoke from public and anon so the intent
-- is readable rather than inherited, then grant execute to the one role that
-- calls it. Nothing on any table changes, and the three replaced writers keep
-- the ACLs `0032` set — `create or replace` preserves them, and re-issuing
-- them here would only hide a `0032` regression behind a `0033` re-grant.
-- ---------------------------------------------------------------------------

revoke all on function public.finish_shopping_run(uuid) from public, anon;

grant execute on function public.finish_shopping_run(uuid) to authenticated;
