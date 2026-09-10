-- Putting a shopping list away without losing what it bought — story #360.
--
-- A household shops at more than one kind of store, so `0032` gave it several
-- named lists and #358 gave it a picker. A list that is finished with — the
-- one for a renovation, the one for a party that happened — still has to leave
-- the picker, and its finished runs still have to be readable: the epic's
-- decision was that NOTHING in this feature is ever deleted, and the charter's
-- 2026-08-26 leave/close decision already prefers set-null attribution over
-- cascading loss. So a list is ARCHIVED — one nullable stamp on the list row,
-- written by the database clock like every stamp since `0004`.
--
-- The file is `0035`, not the `0033` the story names: the story was groomed on
-- 2026-09-05 when `0032` was the last file, and `0033` (#354) and `0034` (#368)
-- landed between the grooming and the pickup. Every migration number in #360's
-- text is two behind for that reason, and the reference to "a later paste of
-- 0031" means `0033` — the file that currently declares both bodies this one
-- replaces.
--
-- ===========================================================================
-- Why an archive is refused while the open run holds ANYTHING
-- ===========================================================================
--
-- The story's AC 1 says "unbought items" and its own rationale paragraph calls
-- an archived list's open run "empty". Those are two different rules, and the
-- owner took the stricter one at this story's pickup (2026-09-06). The reason
-- is what the looser one leaves behind:
--
--   * a list whose open run holds only BOUGHT items could be archived, and
--     those rows would then be reachable from nowhere — an open run is not
--     history (`readClosedRuns` is `closed_at is not null`), and the archived
--     list draws its past runs only. The household would have a receipt it
--     cannot read;
--   * `unpurchase_shopping_item` on such a row would put an UNBOUGHT item on
--     an archived list, which nothing could then finish or clear;
--   * and every one of those states needs its own screen and its own refusal.
--
-- With the strict rule an archived list's open run is empty BY CONSTRUCTION,
-- and three consequences follow for free: nothing is invisible, the tab has
-- one thing to draw for an archived list (its history), and
-- `purchase_shopping_item`, `unpurchase_shopping_item` and
-- `remove_shopping_item` need no archive check at all — they take an ITEM, and
-- an archived list has none to take. That is why this file replaces exactly
-- two of the five writers.
--
-- "finish or clear this run first" is the sentence either way, and it names
-- both ways out: Done shopping is on screen whenever the run holds a row, and
-- Remove is on every unbought one.
--
-- ===========================================================================
-- The lock, and why it is the LIST's row and not the RUN's
-- ===========================================================================
--
-- The refusal above is a read followed by a write, so between the count and
-- the stamp another phone could add an item — and the item would land on an
-- archived list, which is the state the count exists to prevent.
--
-- THE FIRST DRAFT OF THIS FILE LOCKED THE RUN, AND IT WAS WRONG. It read the
-- list's open run with `where r.list_id = … and r.closed_at is null for update
-- of r`, which is the same row and the same mode `finish_shopping_run` takes,
-- and the reasoning looked complete: every writer of the run holds a
-- conflicting lock, in one order. Found by review before this file's second
-- apply (#360's fan-out, 2026-09-06, five of six lenses):
--
--   1. A finish holds the open run R1 `for update` and is copying its unbought
--      items onto a new run R2.
--   2. An archive arrives and blocks on R1 — matched through the predicate
--      `closed_at is null`.
--   3. The finish commits. READ COMMITTED re-evaluates the archive's qual
--      against the NEW version of R1, whose `closed_at` is now set, and
--      **skips the row**. R2 was inserted after the archive statement's
--      snapshot, so the scan cannot see it either.
--   4. `found` is false, so the emptiness check is skipped WHOLE, and the
--      stamp lands: an archived list whose open run holds the items the finish
--      just carried forward.
--
-- The lesson generalises past this schema, and cairn's
-- `a-row-lock-serialises-only-the-writers-that-lock` is one turn short of it:
-- enumerating every writer and giving each a conflicting lock in one order is
-- necessary and NOT sufficient. **A lock taken through a MUTABLE predicate
-- does not survive the row it matched being retired** — the archive locked
-- correctly and still lost, because the row it locked stopped being the row
-- the question was about.
--
-- So the archive locks the one row in this feature whose identity cannot
-- change: THE LIST'S. `for update` on `shopping_lists`, before anything else,
-- and the two writers that can put an item on a list take `for key share` on
-- that same row first:
--
--   * an add or a finish in flight holds the list for key share, so the
--     archive WAITS, and every statement it runs afterwards takes a fresh
--     snapshot that sees whatever they committed — including a run they
--     created — and refuses;
--   * an archive in flight holds the list for update, so an add or a finish
--     WAITS, then reads `shopping_lists.archived_at` below its own lock on a
--     fresh snapshot and is refused with `this list is archived`.
--
-- The lock order is now LIST -> RUN -> ITEM, and it is total: the archive
-- takes only the first rung, `finish_shopping_run` takes all three, and
-- `add_shopping_item` the first two. `purchase_shopping_item`,
-- `unpurchase_shopping_item` and `remove_shopping_item` still take run then
-- item and NO list lock, which is safe because none of them can raise the item
-- count on an open run — a purchase and an un-purchase move a stamp, and a
-- remove only lowers it. Nothing holds a list lock while waiting for a run it
-- did not already take in that order, so there is no cycle.
--
-- `unarchive_shopping_list` takes no lock at all, and that is not an
-- oversight. It only ever makes writes legal that were refused, so both
-- orderings of an unarchive against an add are correct: the add either sees
-- the stamp and is refused, or does not and lands on a list that is coming
-- back. There is no state to protect.
--
-- ===========================================================================
-- What archiving does NOT do
-- ===========================================================================
--
-- It does not close the open run, delete a row, or move one. The list keeps
-- its empty open run, so unarchiving is one `update` and the list comes back
-- exactly as it was left — which is what makes this reversible, and it is the
-- reason archive is not "finish and hide". It does not touch the unique index
-- on `(household_id, lower(name))` either: an archived `Groceries` still holds
-- that name, so creating a second one is refused with #358's own sentence and
-- the person is told to look behind Show archived rather than given a
-- duplicate they cannot tell apart.
--
-- Renaming is left alone: the client's `update (name)` grant and
-- `shopping_lists_update_same_household` are `0032`'s and are unchanged, so an
-- archived list is renameable by a client that asks. The Shop tab does not ask
-- — an archived list offers Unarchive and nothing else — and that is a screen
-- decision rather than a grant, stated here so the next reader does not go
-- looking for the missing revoke.
--
-- ===========================================================================
-- Re-runnability, and the re-paste hazard this file is on the wrong end of
-- ===========================================================================
--
-- `add column if not exists`, `create or replace`, and a grant that is
-- idempotent by nature. Re-runnable against the schema this file was written
-- for, which is the only claim any migration here makes (cairn's
-- `a-migration-is-re-runnable-only-against-its-own-schema`);
-- `archive-shopping-list.pglite.test.js` applies it twice to prove it.
--
-- The mirror direction is the one to know, and it is now two files deep:
--
--   * re-pasting `0033` alone silently restores the PRE-ARCHIVE bodies of
--     `add_shopping_item` and `finish_shopping_run` — both are declared there
--     and both are declared here, so the later paste wins and an archived list
--     becomes writable again with nothing erroring;
--   * re-pasting `0032` is worse in kind, because it opens with
--     `revoke all on public.shopping_lists from authenticated, anon` and then
--     grants four columns by name. `archived_at` is not among them, so the
--     client stops being able to READ the stamp: every list comes back looking
--     active, the picker shows the ones that were put away, and nothing
--     refuses anything. It also restores `add_shopping_item` to its `0032`
--     body, which has neither the archive check nor `0033`'s run lock, and
--     hands the client back the DELETE `0034` withdrew.
--
-- So the safe re-paste order is the whole sequence, `0032` → `0033` → `0034`
-- → `0035`, and it now ends here. The suite asserts both directions rather
-- than leaving them to be discovered.

-- ---------------------------------------------------------------------------
-- 1. The column, and the one grant that goes with it
--
-- Nullable with no default: null IS the active state, so no existing row has
-- to be touched and no backfill can get it wrong. There is deliberately no
-- CHECK constraint pairing it with anything — unlike `shopping_runs`'
-- closer-implies-close, an archive has no second column to be consistent with.
--
-- The grant is ADDITIVE on top of `0032`'s four columns, and per column for
-- `0014`'s reason: the client reads the stamp because the picker has to know
-- which lists to hide, and it writes nothing here — `archived_at` is not in
-- the `update (name)` grant, so the two functions below are its only writers.
-- `anon` is granted nothing and `0032`'s revoke still stands.
-- ---------------------------------------------------------------------------

alter table public.shopping_lists
  add column if not exists archived_at timestamptz;

comment on column public.shopping_lists.archived_at is
  'When the household put this list away. Null means active. Written only by '
  'archive_shopping_list and unarchive_shopping_list from the database clock; '
  'an archived list keeps every run it ever had and its open run is empty by '
  'the archive precondition. Story #360.';

grant select (archived_at) on public.shopping_lists to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Archive, under the run's lock
-- ---------------------------------------------------------------------------

create or replace function public.archive_shopping_list(list uuid)
returns public.shopping_lists
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target public.shopping_lists;
  held int;
  put_away public.shopping_lists;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  -- A list in another household is refused with the SAME sentence a
  -- nonexistent id gets, so which of the two you hit is free information —
  -- `complete_chore`'s rule, kept by every function in this feature.
  select l.* into target
  from public.shopping_lists l
  where l.id = archive_shopping_list.list
    and l.household_id in (select public.current_household_ids());

  if not found then
    raise exception 'no such list in your household';
  end if;

  if target.archived_at is not null then
    raise exception 'this list is archived';
  end if;

  -- THE LOCK: for update, on the LIST's row — see the header for the draft
  -- that took for update of r on the open run instead, and the ordering that
  -- defeated it. This row's identity cannot change, so nothing a concurrent
  -- writer does can make the lock apply to a different row or to none.
  --
  -- `perform` rather than a `select … into`: the row's CONTENTS were read
  -- above and nothing here needs them again; what this statement is for is the
  -- lock.
  perform 1
  from public.shopping_lists l
  where l.id = target.id
  for update;

  -- The emptiness question, asked of the LIST rather than of a run row read
  -- earlier, and asked AFTER the lock so this statement's own snapshot sees
  -- whatever an add or a finish committed while we waited. Joining through
  -- `closed_at is null` here is safe where locking through it was not: this is
  -- a read whose answer is used immediately, under a lock that stops anything
  -- changing it, rather than a lock whose subject can be retired.
  --
  -- A list with no open run at all counts zero and archives, which is correct:
  -- nothing can be added to a list with no open run.
  select count(*)::int into held
  from public.shopping_items i
  join public.shopping_runs r on r.id = i.run_id
  where r.list_id = target.id
    and r.closed_at is null;

  if held > 0 then
    raise exception 'finish or clear this run first';
  end if;

  update public.shopping_lists
     set archived_at = now()
   where shopping_lists.id = target.id
  returning * into put_away;

  return put_away;
end;
$$;

comment on function public.archive_shopping_list(uuid) is
  'Put a list in the caller''s household away: stamp archived_at from the '
  'database clock so the picker hides it while every finished run stays '
  'readable. Refused while the list''s open run holds any item — finish or '
  'clear it first — checked under a for-update lock on the LIST row, which an '
  'add and a finish both take for key share, so nothing can put an item on the '
  'list behind the count. Deletes nothing and closes nothing. Story #360.';

-- ---------------------------------------------------------------------------
-- 3. Unarchive
--
-- No lock, no precondition beyond the stamp being there: it re-permits writes
-- rather than protecting a state, so every interleaving of it is already
-- correct (header).
-- ---------------------------------------------------------------------------

create or replace function public.unarchive_shopping_list(list uuid)
returns public.shopping_lists
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target public.shopping_lists;
  brought_back public.shopping_lists;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  select l.* into target
  from public.shopping_lists l
  where l.id = unarchive_shopping_list.list
    and l.household_id in (select public.current_household_ids());

  if not found then
    raise exception 'no such list in your household';
  end if;

  -- Refused by name rather than silently doing nothing, the family's rule
  -- since `0034`: two phones both tapping Unarchive, and the second is told
  -- what happened instead of watching a re-read explain it.
  if target.archived_at is null then
    raise exception 'this list is not archived';
  end if;

  update public.shopping_lists
     set archived_at = null
   where shopping_lists.id = target.id
  returning * into brought_back;

  return brought_back;
end;
$$;

comment on function public.unarchive_shopping_list(uuid) is
  'Bring an archived list in the caller''s household back: clear archived_at '
  'and nothing else moves, so the list returns with the empty open run it was '
  'put away with. Refuses a list that is not archived by name. Story #360.';

-- ---------------------------------------------------------------------------
-- 4. The two writers that can reach an archived list, replaced
--
-- Each body is `0033`'s with ONE addition: after the run's lock and its own
-- closed check, the list's `archived_at` is read and a non-null one is
-- refused. Signatures, arguments, stamps, locks and every other refusal are
-- unchanged, so both are true replaces and PostgREST's argument-name
-- resolution is untouched — no overload, no `PGRST203`.
--
-- The check sits BELOW the run lock in both, deliberately: read above it, the
-- stamp would come from a snapshot taken before whatever we then waited for,
-- which is the whole failure `0033` closed for `closed_at`.
--
-- The other three item writers are not here, and the header says why: an
-- archived list's open run is empty by the archive precondition, so there is
-- no item for a purchase, an un-purchase or a remove to name.
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
  target_list uuid;
  list_archived_at timestamptz;
  made public.shopping_items;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  if item_name is null or item_name = '' then
    raise exception 'an item needs a name';
  end if;

  -- #360 — WHICH LIST, read with no lock at all. The lock order is
  -- list -> run -> item, so the list has to be identified before either of the
  -- other two rows is touched, and identifying it is a read.
  select r.list_id into target_list
  from public.shopping_runs r
  where r.id = add_shopping_item.run
    and r.household_id in (select public.current_household_ids());

  if not found then
    raise exception 'no such run in your household';
  end if;

  -- #360 — the LIST row, `for key share`, and it is the first rung. An archive
  -- holds this row `for update`, so an add that arrives while one is in flight
  -- waits here and then reads the stamp it wrote. The archive cannot take its
  -- lock through a predicate over runs (the header says why), so this is the
  -- row both of them meet on.
  perform 1
  from public.shopping_lists l
  where l.id = target_list
  for key share;

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

  -- #360, and below the lock for the reason the header gives. The run's own
  -- state is reported first: `run already closed` is a fact about the run
  -- named, and this is a fact about the list it belongs to.
  select l.archived_at into list_archived_at
  from public.shopping_lists l
  where l.id = target.list_id;

  if list_archived_at is not null then
    raise exception 'this list is archived';
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
  'share so an add cannot slip onto a run a finish is closing (#354), and the '
  'LIST row for key share first so it cannot slip onto a list an archive is '
  'putting away (#360). Story #352.';

create or replace function public.finish_shopping_run(run_id uuid)
returns public.shopping_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target public.shopping_runs;
  target_list uuid;
  list_archived_at timestamptz;
  finisher uuid;
  opened public.shopping_runs;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  -- #360 — WHICH LIST, read with no lock, for `add_shopping_item`'s reason:
  -- the order is list -> run -> item, and the list has to be named before it
  -- can be locked.
  select r.list_id into target_list
  from public.shopping_runs r
  where r.id = finish_shopping_run.run_id
    and r.household_id in (select public.current_household_ids());

  if not found then
    raise exception 'no such run in your household';
  end if;

  -- #360 — the LIST row, `for key share`, and it is the first rung. This is
  -- the lock an archive conflicts with, and it is what makes the archive's
  -- emptiness check sound: a finish either commits before the archive's count
  -- (which then sees the run it opened) or waits for the stamp and refuses.
  -- The archive cannot meet this function on the RUN row, because the run it
  -- would have to lock is the one this function is retiring.
  perform 1
  from public.shopping_lists l
  where l.id = target_list
  for key share;

  -- The lock. Everything below happens while this row is held, so two calls
  -- on one run are serialised here and the second one reads the close the
  -- first one wrote. The run is locked before any item — the order every
  -- writer in this schema follows (`0033`'s header), now with the list above
  -- it.
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

  -- #360. Without it an archived list could still be finished, and the finish
  -- would OPEN a fresh run on it — a list that is put away growing a new run
  -- every time somebody taps a stale screen. The story's own rationale names
  -- this as the reason this function is replaced here.
  select l.archived_at into list_archived_at
  from public.shopping_lists l
  where l.id = target.list_id;

  if list_archived_at is not null then
    raise exception 'this list is archived';
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
  'the list, so a stale screen cannot finish the fresh run. Refuses an '
  'archived list (#360). The only writer of closed_at and '
  'closed_by_member_id. Story #354.';

-- ---------------------------------------------------------------------------
-- 5. Privileges
--
-- `0010`'s shape, as `0032`, `0033` and `0034` all have it: revoke from public
-- AND anon so the intent is readable rather than inherited, then grant execute
-- to the one role that calls it. The second word is load-bearing on the hosted
-- project and no test here can tell you so — `revoke ... from public` alone
-- removes only the PUBLIC default, which under pglite is all `anon` has, while
-- the live project holds something this harness never builds. `0034` measured
-- exactly that stray and cairn records the shape in
-- `the-harness-cannot-catch-what-the-platform-granted`. Copy the idiom; do not
-- re-derive it.
--
-- Nothing is re-issued for the two REPLACED functions: `create or replace`
-- preserves the ACLs their own files set, and re-granting here would hide a
-- `0032`/`0033` regression behind a `0035` re-grant.
-- ---------------------------------------------------------------------------

revoke all on function public.archive_shopping_list(uuid) from public, anon;
grant execute on function public.archive_shopping_list(uuid) to authenticated;

revoke all on function public.unarchive_shopping_list(uuid) from public, anon;
grant execute on function public.unarchive_shopping_list(uuid) to authenticated;
