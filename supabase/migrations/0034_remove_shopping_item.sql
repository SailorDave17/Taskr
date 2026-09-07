-- Removing a shopping item, under the run's lock — story #368.
--
-- The fourth writer of `shopping_items`, and the last one that was not a
-- function. `0033` (#354) gave the other three the same lock order — the RUN
-- row `for key share` before the item is touched — and could not give it to
-- this one, because this one is not code: it is the client's own
-- `delete from shopping_items` under `0032`'s
-- `shopping_items_delete_unbought_on_open_run` policy, and **a policy cannot
-- take a lock**. `0033`'s header says so in as many words and files it here.
--
-- ===========================================================================
-- The window this closes, which is a LOST RECORD and not a lost delete
-- ===========================================================================
--
-- A finish is in flight and has already locked an unbought item as a source
-- for the carry. A remove of that same item arrives:
--
--   1. It waits, because the carry holds the row.
--   2. The finish commits: the run is closed, and a COPY of the item exists on
--      the next run with `carried_from_item_id` pointing back at the original.
--   3. The delete proceeds — against the ORIGINAL. Its policy predicate was
--      evaluated on the statement's own older snapshot, where the run still
--      read as open, so nothing refuses it.
--
-- What is left: the closed run has lost its record of an item it held, which
-- breaks `0032`'s "a bought item is history and a closed run is the record";
-- and the copy on the next run survives with `carried_from_item_id` nulled by
-- `on delete set null`, so it is indistinguishable from an item somebody typed
-- in. Nothing errors. The household sees an item it never added, and a
-- finished trip that has forgotten one.
--
-- Milliseconds wide, and unreachable by every instrument this repo has:
-- pglite is one connection, so `finish-shopping-run.pglite.test.js` runs the
-- two calls end to end; and #356's live race harness is finish-against-finish
-- only. That is why this landed as a story from a review rather than from a
-- failing test — cairn's `a-shape-check-family-cannot-reach-invalidity` is the
-- general form, and the specific one is that a guard family complete for
-- FUNCTIONS says nothing about the one writer that is not a function.
--
-- ===========================================================================
-- The route: make the fourth writer a function too (owner's, at the gate)
-- ===========================================================================
--
-- The alternative on the table was a `before delete` trigger taking the run
-- lock and re-reading `closed_at`, which would have left the client's DELETE
-- grant and policy in place. The RPC was taken instead, and the reason is that
-- it leaves **no client DML on `shopping_items` at all**: after this file the
-- four writers of that table are four `security definer` functions with one
-- lock order between them, which is what `0032`'s own header wanted when it
-- said "the four RPCs are the only writers" and then granted a delete anyway.
-- A trigger would have been a second mechanism enforcing the same rule from
-- underneath, and the next person reading the grants would still see a client
-- that may delete rows.
--
-- So the grant and the policy go, in this same file. That pairing is the
-- point: a revoke without the RPC would break the Remove control, and an RPC
-- without the revoke would leave the racing path open beside it.
--
-- ===========================================================================
-- What a refused remove says (owner decision, 2026-09-06)
-- ===========================================================================
--
-- It RAISES, with the sentences the family already uses — `run already closed`
-- and `item already bought` — rather than deleting nothing and letting the
-- re-read explain it. Taken against preserving today's silence: every other
-- writer of these three tables refuses by name, App's `mutate()` already puts
-- such a sentence on the error strip, and a person who taps Remove and watches
-- nothing happen is owed the reason. The visible change is small and
-- deliberate: a Remove tapped on an item another phone bought a second earlier
-- now says so instead of quietly re-reading it as bought.
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- `create or replace`, `drop policy if exists`, and revokes that are no-ops
-- when the privilege is already gone. Re-runnable against the schema AS THIS
-- FILE LEAVES IT, which is the only claim a migration can make about itself
-- (cairn's `a-migration-is-re-runnable-only-against-its-own-schema`): a
-- later file that re-granted the delete would make a second apply of this one
-- meaningful again, which is the correct behaviour and not a bug.

-- ---------------------------------------------------------------------------
-- 1. The RPC — the same lock order as the other three
-- ---------------------------------------------------------------------------

create or replace function public.remove_shopping_item(item uuid)
returns void
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

  -- Which run, read WITHOUT a lock on the item — the item is locked only after
  -- the run is held, so the lock order matches the finish's. Copied from
  -- `purchase_shopping_item` deliberately: four writers with one order is the
  -- property, and it is only a property if they are the same shape.
  select i.* into target
  from public.shopping_items i
  where i.id = remove_shopping_item.item
    and i.household_id in (select public.current_household_ids());

  if not found then
    raise exception 'no such item in your household';
  end if;

  -- The run first, `for key share`. A finish in flight holds this row `for
  -- update`, so this waits for it and then reads the close it wrote — on a
  -- FRESH snapshot, which is exactly what the client's DELETE could not do.
  select r.closed_at into run_closed_at
  from public.shopping_runs r
  where r.id = target.run_id
  for key share of r;

  if run_closed_at is not null then
    raise exception 'run already closed';
  end if;

  -- Now the item, `for update`, re-read under the lock so a purchase that
  -- landed between the first read and this one is seen. Without the re-read
  -- this would delete a row bought a millisecond ago.
  select i.* into target
  from public.shopping_items i
  where i.id = remove_shopping_item.item
  for update of i;

  if target.purchased_at is not null then
    raise exception 'item already bought';
  end if;

  delete from public.shopping_items where id = target.id;
end;
$$;

comment on function public.remove_shopping_item(uuid) is
  'Remove an unbought item from an open run, holding the run row for key share '
  'first so a remove cannot race a finish and strip the closed run''s record of '
  'the item. Replaces the client DELETE and the policy 0032 granted, which '
  'could not take that lock. Refuses a bought item and a closed run by name. '
  'Story #368.';

-- `from public, anon` — 0032's and 0033's idiom, and the second word is
-- load-bearing on this project: with `from public` alone the live catalog read
-- `anon` STILL HOLDING execute on this function, reported as a stray by
-- `npm run probe:live-grants` on this file's first apply.
--
-- And no test in this repo could have told you. `from public` alone removes
-- the PUBLIC default, so under pglite `has_function_privilege('anon', …)` is
-- already false and the assertion in finish-shopping-run.pglite.test.js stays
-- green — measured, by putting the first draft back and running it. The live
-- project holds something the harness does not build, so the catalog probe is
-- the only instrument for this class. Copy the idiom; do not re-derive it.
revoke all on function public.remove_shopping_item(uuid) from public, anon;
grant execute on function public.remove_shopping_item(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The client's own delete, withdrawn
--
-- Both halves, in this order and in this file. The policy alone would leave a
-- grant with no rows to act on; the grant alone would leave a policy waiting
-- for a grant to arrive, which `0032`'s own header calls "a second way in".
-- After this, `authenticated` holds SELECT on every column of
-- `shopping_items`, `UPDATE (name)` on `shopping_lists`, and no other DML
-- anywhere in the feature.
-- ---------------------------------------------------------------------------

revoke delete on public.shopping_items from authenticated, anon;

drop policy if exists shopping_items_delete_unbought_on_open_run on public.shopping_items;
