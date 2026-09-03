-- Completing an unassigned chore assigns it to the completer — story #307.
--
-- Until this file, a member who did a chore nobody was assigned was credited
-- in the done group's row and INVISIBLE in the fairness figure. The mechanism
-- is three artefacts agreeing: `complete_chore` (0015, replaced by 0027) sets
-- `completed_at`, `completed_by_member_id` and `actual_minutes` and leaves
-- `assigned_member_id` alone; `toAllocatorChores` (src/lib/chores.js) carries
-- only `assignedMemberId`, never the completer; and `assess`
-- (src/lib/allocation.js) drops a done chore with no holder from the
-- arithmetic entirely — "work nobody holds AND that is already done
-- contributes nowhere". So the minutes went to nobody, in the one place the
-- charter says the household's argument ends.
--
-- ===========================================================================
-- Why this reverses a decision rather than filling a gap
-- ===========================================================================
--
-- #35 considered exactly this as its option (c) — "auto-assign to the
-- completer" — and the owner chose (a): allow the completion, attribute it,
-- build no surface. The objection then was real: a holder written by a
-- completion would later surface in stored re-assignment as "a re-balance that
-- never happened", because the column said WHO without saying HOW.
--
-- #49 (0018) answered that objection by adding `assigned_source`, and a
-- manual holder is already never moved by the allocator. So the reversal is
-- not a change of mind about the risk — it is the risk having acquired a
-- mechanism. The owner instructed the reversal on 2026-09-01; the charter's
-- decision log records it, and #35 carries a comment pointing here.
--
-- ===========================================================================
-- Why a THIRD source value and not 'manual'
-- ===========================================================================
--
-- `manual` would claim a human placed the chore on somebody, and that claim is
-- read: `apply_assignments` (0018) treats a manual holder as PINNED and the
-- allocator must never move it. A completion-set holder deserves that same
-- protection while it is done — and it gets it for a different reason (the
-- `completed_at is null` guard, below) — but the two facts must stay
-- distinguishable, because UN-completion has to know which one it is looking
-- at.
--
-- With `manual`, "Not done after all" on a chore nobody was ever assigned
-- would leave the completer holding it as though a person had chosen them.
-- The row would then be pinned against the allocator, permanently, on the
-- strength of a tap that has since been taken back. `completed` lets
-- un-completion undo exactly what completion did and nothing else.
--
-- ===========================================================================
-- The rule
-- ===========================================================================
--
--   * Unassigned at completion  -> holder := the completer,
--                                  source := 'completed'.
--   * Already assigned          -> holder and source UNTOUCHED, even when
--                                  somebody else completes it. The owner's
--                                  instruction, and the honest one: an
--                                  assignment is a commitment somebody made,
--                                  and a helper finishing it does not transfer
--                                  it. `completed_by_member_id` still records
--                                  who actually did the work, as it always has.
--   * Un-complete a 'completed' row -> holder and source return to null,
--                                  restoring the pre-completion state exactly.
--   * Un-complete a manual/auto row -> assignment untouched, as today.
--   * A MISSED chore (#305) is never assigned by this rule. `miss_chore`
--     writes no assignment, and nothing here runs on that path — nothing was
--     completed, so nobody earned the credit.
--
-- ===========================================================================
-- What this does NOT change
-- ===========================================================================
--
-- No client code. `assigned_source` is already in the column list
-- `src/lib/chores.js` selects, `toAllocatorChores` already carries
-- `assignedMemberId`, `assess` already counts a done chore for its holder at
-- its actual minutes, and `ChoreRow` already renders `assigned_member_id` the
-- same way on the Chores tab and the Done surface. The Split starts counting
-- these minutes because the DATABASE started writing the holder — which is why
-- this story is one migration and its tests.
--
-- No grant moves either. `assigned_member_id` and `assigned_source` are
-- written here by a `security definer` function, exactly as
-- `completed_by_member_id` is; the client's own update grant is unchanged and
-- still cannot reach either column directly. `assign_chore` and
-- `unassign_chore` remain the only client-facing writers of an assignment.
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- Applied by `npm run migrate:live` or a hand paste; a re-paste is the normal
-- path. The constraint is DROPPED and re-added under one lock rather than
-- guarded by a catalog lookup, because unlike 0027's new constraint this one
-- ALREADY EXISTS with a narrower definition — a `if not exists` guard would
-- read the old constraint as present and leave the widening unapplied, which
-- is the failure mode that looks like success. Dropping a check constraint and
-- adding it back inside one statement holds an ACCESS EXCLUSIVE lock for the
-- validation scan, which on this table is milliseconds.
--
-- Both functions are `create or replace` with UNCHANGED signatures, so no
-- overload is created and PostgREST's argument-name resolution is untouched.
-- Neither re-issues a privilege statement: `create or replace` preserves the
-- ACLs 0004 set.
--
-- There is no backfill, and its absence is deliberate rather than forgotten.
-- Every row completed before this file was completed under the old rule, and
-- the household's fairness figure for those weeks was computed without them.
-- Writing a holder onto them now would silently restate history — weeks the
-- household has already looked at and agreed about would change. The rule
-- applies from here.

-- ---------------------------------------------------------------------------
-- 1. The constraint learns the third value
-- ---------------------------------------------------------------------------

alter table public.chores
  drop constraint if exists chores_assigned_source_known;

alter table public.chores
  add constraint chores_assigned_source_known
  check (assigned_source is null or assigned_source in ('manual', 'auto', 'completed'));

comment on column public.chores.assigned_source is
  'How the assignment in assigned_member_id was decided. `manual` — a person '
  'chose the holder through assign_chore; the allocator never moves it. '
  '`auto` — apply_assignments placed it; the allocator may move it. '
  '`completed` — complete_chore set it because the chore was unassigned when '
  'somebody finished it (#307); un-completing clears both columns. Null means '
  'unassigned. Meaningful only when assigned_member_id is not null: the '
  'composite FK''s on-delete-set-null clears the member and cannot clear this, '
  'so a dangling source under a null member reads as unassigned.';

-- ---------------------------------------------------------------------------
-- 2. complete_chore claims the unheld chore for whoever did it
-- ---------------------------------------------------------------------------

-- Identical to 0027's version except the two `assigned_*` lines. Same
-- signature, so this is a true replace, not an overload.
create or replace function public.complete_chore(chore_id uuid)
returns public.chores
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.chores;
  caller uuid := (select auth.uid());
  completer uuid;
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

  -- Resolved ONCE and used for both columns, so the holder this writes and the
  -- completer it records can never be two different people. Computing it twice
  -- would be two calls that happen to agree today.
  completer := public.acting_member(target.household_id);

  update public.chores
     set completed_at = now(),
         completed_by_member_id = completer,
         -- #307. `chores.assigned_member_id` on the RIGHT of a SET is the row's
         -- value BEFORE this statement — Postgres evaluates every expression
         -- against the old row, and the SET list has no order — so both lines
         -- read the same pre-update holder however they are arranged. That is
         -- the question the rule is about: was it unassigned when they started
         -- it? A chore already held keeps its holder and its source whoever
         -- finishes it. The row is also locked by the SELECT above, so no
         -- concurrent completion can slip between the read and this write.
         assigned_member_id = coalesce(chores.assigned_member_id, completer),
         assigned_source = case
           when chores.assigned_member_id is null then 'completed'
           else chores.assigned_source
         end,
         -- The zero-tap default (0015): doing nothing records the estimate as
         -- the best claim of the cost. Coalesce, so a retained actual from an
         -- earlier completion is never stamped over.
         actual_minutes = coalesce(chores.actual_minutes, chores.expected_minutes),
         -- #305: "did it after all". The constraint added by 0027 would refuse
         -- a row carrying both stamps; clearing the miss here is what makes
         -- Done win rather than raise.
         missed_at = null
   where id = chore_id
  returning * into target;

  return target;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. uncomplete_chore gives back exactly what completion took
-- ---------------------------------------------------------------------------

-- Identical to 0007's version except the two `assigned_*` lines. Same
-- signature; a true replace.
create or replace function public.uncomplete_chore(chore_id uuid)
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
     set completed_at = null,
         completed_by_member_id = null,
         -- #307. The source is what makes this safe to do: ONLY an assignment
         -- this function's counterpart wrote is cleared. A manual holder and
         -- an allocator-placed one both survive an undo, because neither was
         -- created by the tap being taken back.
         assigned_member_id = case
           when chores.assigned_source = 'completed' then null
           else chores.assigned_member_id
         end,
         assigned_source = case
           when chores.assigned_source = 'completed' then null
           else chores.assigned_source
         end
   where id = chore_id
  returning * into target;

  return target;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Privileges
-- ---------------------------------------------------------------------------

-- Deliberately none. Both functions keep the ACLs 0004 set (`create or
-- replace` preserves them), no column changed its grant, and no new object
-- exists to grant on. `npm run probe:live-grants` reads `assigned_source` back
-- as it was before this file.
