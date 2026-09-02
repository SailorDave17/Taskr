-- A chore that did not get done — story #305.
--
-- The third state. Until this file an outstanding row had exactly two exits:
-- Done, which credits somebody with work and feeds #12's actuals a figure, and
-- Remove, which destroys the row and — for a generated occurrence — the history
-- #105 keeps on purpose. Neither is true of a chore nobody did. A daily that
-- slips once had no honest exit at all, and #306's stacking rule needs this
-- state to write into.
--
-- ===========================================================================
-- One nullable column, not an outcome qualifier on completion
-- ===========================================================================
--
-- `missed_at timestamptz`, null for every row that exists today. A chore is
-- OUTSTANDING iff `completed_at` and `missed_at` are both null — that is the
-- one definition, and `src/lib/chores.js`'s `isOutstanding` is the client copy
-- of it. The alternative the story records as rejected is an `outcome` column
-- beside `completed_at`: every reader of `completed_at` (#12's actuals, #47's
-- split, #105's history, #302's grouping) would have had to learn the
-- qualifier, where a separate column leaves all of them untouched — a missed
-- chore has no `completed_at`, so it is invisible to them by construction.
--
-- The two columns are mutually exclusive, and the CHECK below is what makes
-- that a fact rather than a convention: "done AND not done" is not a state
-- anything here knows how to render or to count.
--
-- ===========================================================================
-- Why missing goes through a definer function, exactly as completing does
-- ===========================================================================
--
-- 0004's argument, unchanged: the CLOCK. `missed_at` decides which capacity
-- week the Done surface files the row under (#302 groups by the week a chore
-- was settled in, in the household's zone), so a client timestamp is a foreign
-- input to that grouping. The column is therefore READABLE and NOT WRITABLE by
-- any client role — 0004's shape, and 0003's additive-by-column convention:
-- this file grants select on the one column it adds and no update on it, and
-- the "a client cannot write this" test lives in this story
-- (src/test/missed.pglite.test.js).
--
-- What a missed chore CONTRIBUTES is nothing, and the schema enforces the half
-- it can: `miss_chore` writes no actual, no attribution and no completion, so
-- the row carries no figure for any reader to sum. The client half — the
-- allocator dropping it, the actuals ignoring it — is `src/lib/chores.js`.
--
-- ===========================================================================
-- Done wins
-- ===========================================================================
--
-- Marking a missed chore done clears `missed_at` and completes it as today:
-- "did it after all" needs no extra control, and `complete_chore` is replaced
-- below with that one additional assignment. The other direction is refused —
-- `miss_chore` on a completed row raises rather than quietly un-completing it,
-- because "it did not happen" said about work somebody has already been
-- credited for is a claim the person who did it should get to contest;
-- `uncomplete_chore` then `miss_chore` is two deliberate taps.
--
-- `miss_chore` on a row already missed keeps the FIRST stamp (coalesce), so a
-- double tap from two phones cannot move the row between weeks.
-- `unmiss_chore` puts it back on the list; it touches nothing else, because
-- nothing else was written.
--
-- ===========================================================================
-- Repeats
-- ===========================================================================
--
-- Marking an occurrence missed touches nothing on its anchor. The catch-up
-- pass (0026) reads anchors only, keys exactly-once on (generated_from,
-- due_on), and never reads a completion column — so the next occurrence
-- generates as normal, which repeats.pglite.test.js proves for this story.
-- `chores_outstanding_idx` (0004, `where completed_at is null`) is left as it
-- is: it still covers every outstanding row, and a missed row inside it is a
-- handful of extra index entries rather than a wrong answer.
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- Applied by `npm run migrate:live` or a hand paste; a re-paste is the normal
-- path. `add column if not exists`, the constraint guarded by a catalog check
-- (an ALTER-added constraint has no inline idempotent form — 0012's pattern),
-- `create or replace` on `complete_chore` whose signature DOES NOT CHANGE
-- (same argument set, so no overload and PostgREST's name-set resolution is
-- untouched), `create or replace` on the two new functions, and privilege
-- statements that are idempotent by nature.

-- ---------------------------------------------------------------------------
-- 1. The column and the constraint
-- ---------------------------------------------------------------------------

alter table public.chores
  add column if not exists missed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chores_not_both_done_and_missed') then
    alter table public.chores add constraint chores_not_both_done_and_missed
      check (completed_at is null or missed_at is null);
  end if;
end $$;

comment on column public.chores.missed_at is
  'When the chore was recorded as not done, by the database''s clock. Null '
  'means it was not recorded as missed. Set only by miss_chore, cleared by '
  'unmiss_chore or by complete_chore (done wins). A missed chore contributes '
  'no load, no actual and no credit to anybody. Mutually exclusive with '
  'completed_at. Story #305.';

-- ---------------------------------------------------------------------------
-- 2. The only way to record a miss, and the way back
-- ---------------------------------------------------------------------------

create or replace function public.miss_chore(chore_id uuid)
returns public.chores
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.chores;
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  -- 0015's access rule, verbatim: a chore outside the caller's households is
  -- not found, and the refusal is the same one a nonexistent id gets.
  select c.* into target
  from public.chores c
  where c.id = chore_id
    and c.household_id in (select public.current_household_ids())
  for update of c;

  if not found then
    raise exception 'no such chore in your household';
  end if;

  if target.completed_at is not null then
    raise exception 'that chore is marked done — put it back on the list first';
  end if;

  -- now() is the DATABASE's clock, and that is the whole point of this
  -- function. The client supplies no timestamp and cannot. Coalesce, so a
  -- second tap keeps the first stamp rather than moving the row between weeks.
  update public.chores
     set missed_at = coalesce(chores.missed_at, now())
   where id = chore_id
  returning * into target;

  return target;
end;
$$;

create or replace function public.unmiss_chore(chore_id uuid)
returns public.chores
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.chores;
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  select c.* into target
  from public.chores c
  where c.id = chore_id
    and c.household_id in (select public.current_household_ids())
  for update of c;

  if not found then
    raise exception 'no such chore in your household';
  end if;

  update public.chores
     set missed_at = null
   where id = chore_id
  returning * into target;

  return target;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. complete_chore clears the miss — done wins
-- ---------------------------------------------------------------------------

-- Identical to 0015's version except the one `missed_at` line. Same signature,
-- so this is a true replace, not an overload.
create or replace function public.complete_chore(chore_id uuid)
returns public.chores
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.chores;
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  select c.* into target
  from public.chores c
  where c.id = chore_id
    and c.household_id in (select public.current_household_ids())
  for update of c;

  if not found then
    raise exception 'no such chore in your household';
  end if;

  update public.chores
     set completed_at = now(),
         completed_by_member_id = public.acting_member(target.household_id),
         -- The zero-tap default (0015): doing nothing records the estimate as
         -- the best claim of the cost. Coalesce, so a retained actual from an
         -- earlier completion is never stamped over.
         actual_minutes = coalesce(chores.actual_minutes, chores.expected_minutes),
         -- #305: "did it after all". The constraint above would refuse a row
         -- carrying both stamps; clearing the miss here is what makes Done win
         -- rather than raise.
         missed_at = null
   where id = chore_id
  returning * into target;

  return target;
end;
$$;

-- `uncomplete_chore` is deliberately untouched: a completed row has no
-- `missed_at` (the constraint), so there is nothing for it to clear.

-- ---------------------------------------------------------------------------
-- 4. Privileges
-- ---------------------------------------------------------------------------

-- Readable, because the list has to render the row and the Done surface has
-- to file it under a week. NOT insertable and NOT updatable by any client
-- role: `missed_at` moves only through the two functions above, for 0004's
-- clock reason. The additive-by-column convention means the absence of a
-- `grant update (missed_at)` line IS the withholding — there is no revoke to
-- write, because nothing ever granted it. `npm run probe:live-grants` reads
-- the column back as `r` and no more.
grant select (missed_at) on public.chores to authenticated;

-- 0016's reason, again: Postgres hands PUBLIC execute on every new function,
-- and the hosted platform additionally names `anon` by default — a revoke that
-- only says `public` leaves the by-name entry standing.
revoke all on function public.miss_chore(uuid)   from public, anon;
revoke all on function public.unmiss_chore(uuid) from public, anon;
grant execute on function public.miss_chore(uuid)   to authenticated;
grant execute on function public.unmiss_chore(uuid) to authenticated;

-- `complete_chore` keeps the ACLs 0004 set (`create or replace` preserves
-- them), so no privilege statement is re-issued for it here.
