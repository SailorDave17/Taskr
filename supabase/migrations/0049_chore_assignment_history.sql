-- Who has held each chore, and who moved it — story #481.
--
-- The allocator is memoryless: `allocate` and `reallocate` see the current
-- holder of each chore and nothing about how it got there, and their tie-break
-- is deterministic, so the same household deals the same chore to the same
-- person week after week by construction. A hand move is respected for one
-- week (`0018`'s manual pin) and forgotten the next, when the deal-out hands
-- the chore back. The owner's words (2026-09-16): *if a particular chore keeps
-- getting assigned to one person, especially if it often gets reassigned after
-- it is doled out — create a logic to account for that.*
--
-- That logic needs a record, and this file is the record: one append-only row
-- per assignment change, readable by the household and written by nobody but
-- the database itself. What the client does with it is `src/lib/
-- assignmentHistory.js` (the fold into two signals) and `src/lib/allocation.js`
-- (the steer); the rule is argued about in `docs/allocation-corpus.md`.
--
-- ===========================================================================
-- ONE WRITER, A TRIGGER — not an insert in each RPC
-- ===========================================================================
--
-- Four RPCs own every assignment change (`assign_chore`, `unassign_chore`,
-- `apply_assignments`, `complete_chore` claiming the completer), and the story
-- was filed expecting an insert in each. It is a trigger on `chores` instead,
-- for three reasons that are each enough on their own:
--
--   1. A body replace is a re-paste hazard. `apply_assignments` was last
--      declared by `0042`, `complete_chore` and `uncomplete_chore` by `0029`,
--      the assign pair by `0018`; re-declaring all five here would mean a later
--      re-paste of any of those files SILENTLY dropped the insert from the
--      function it restores — the `0043`-on-`0048` shape, five times over. A
--      trigger survives every re-paste of every function body.
--   2. Two writers the story did not name would be missed. `uncomplete_chore`
--      clears a completion-set holder (the counterpart of the claim the story
--      does name), and a member's removal or leave clears their holdings
--      through `chores_assigned_member_in_household`'s `on delete set null`.
--      Both are assignment changes; both fire this trigger; neither is an RPC.
--   3. A future writer cannot forget it.
--
-- WHEN IT FIRES is the one subtle line, and it is subtle because of what the
-- steer needs to read. "The last three auto allocations all went to A" is
-- exactly the case where the deal-out KEEPS the chore on A — the incumbent
-- wins the tie, the row's values do not change — so a plain "on change"
-- trigger would never record the signal the story is about. The predicate
-- therefore records:
--
--   * every change of holder or of source (a hand move, an unassign, a
--     completion's claim, an un-completion's release, a removal's set-null,
--     and a deal-out that moved the chore), AND
--   * every deal-out placement, moved or not — `new.assigned_source = 'auto'`
--     on a row that is open on both sides. The completion state is compared
--     because `complete_chore` and `uncomplete_chore` both SET the assignment
--     columns while preserving an auto holder, and without that clause a
--     completion of an auto-held chore would read as one more deal-out to
--     that person. `apply_assignments` never touches `completed_at`.
--
-- `after update OF assigned_member_id, assigned_source` limits the firing to
-- statements that SET those columns — a title edit, a completion stamp on an
-- unheld chore's `actual_minutes`, a skip, never reach the predicate.
--
-- ===========================================================================
-- THE SHAPE, and what each column is for
-- ===========================================================================
--
--   chore_id          the row that changed. NO foreign key, on purpose: this
--                     is a record of what happened, and it must outlive the
--                     chore — a repeat's occurrences are new rows every week
--                     (`0012`), and the signal for "the same chore" is the
--                     next column. A removed household takes its history with
--                     it through `household_id`'s cascade, which is the one
--                     deletion this record must follow.
--   repeat_parent_id  `chores.generated_from` at the time of the change — the
--                     key "the same chore across weeks" is read by. Null for a
--                     one-off, whose key is `chore_id`.
--   from_member_id    who held it before, or null.
--   to_member_id      who holds it now, or null (an unassign, a release).
--                     Neither carries a foreign key either: a member who
--                     leaves takes their row with them, and the rows that
--                     say "moved off them twice" are the ones the next
--                     deal-out must still be able to read. The fold ignores
--                     an id that is no longer a candidate.
--   from_source /     `chores.assigned_source` before and after. The words
--   source            are `chores_assigned_source_known`'s (`manual`, `auto`,
--                     `completed`, null) and are deliberately NOT re-checked
--                     here: they are copied from a constrained column by a
--                     definer function, and a second list would be a second
--                     place to widen — `0029`'s and `0046`'s shape.
--   actor_member_id   who did it: `acting_member(household)` for the caller.
--                     Null when the caller is not a member of the household
--                     (the purge, a platform action), which is a fact worth
--                     keeping rather than a row worth refusing.
--   period_start      the Monday of the week the change landed in, in the
--                     HOUSEHOLD'S zone — `member_capacity`'s and
--                     `calendar_busy`'s key, computed here from
--                     `households.timezone` because the trigger has no client
--                     to ask and the four RPCs' signatures must not change.
--                     `date_trunc('week', …)` is ISO, Monday-based (`0005`
--                     says the same), and the check below refuses any other
--                     weekday exactly as `0005` and `0030` do.
--   recorded_at       when.
--
-- ===========================================================================
-- WHO READS, WHO WRITES
-- ===========================================================================
--
-- `authenticated` holds SELECT on every column — `household_id` included, the
-- `0014` route: the client reads this table BY HOUSEHOLD, because a row must
-- outlive the member it names and a member-set scope would drop it the week
-- the member left. One policy, same-household, through
-- `current_household_ids()`. No insert, update or delete grant, no policy for
-- any of them: the trigger function is `security definer` and runs as the
-- owner, so the client needs nothing and gets nothing. `anon` holds nothing,
-- said outright (`0017`'s convention). `service_role`'s default privileges on
-- the live project are the platform's (`arwdDxtm`, `0038`'s measurement) and
-- this file grants the role nothing.
--
-- NOT published to Realtime, by name in `src/lib/realtime.js`'s
-- `UNWATCHED_TABLES`: every row here lands in the same transaction as a
-- `chores` update that IS published, so watching it would echo each
-- assignment event into a second read of the same state.
--
-- ===========================================================================
-- What each instrument can see
-- ===========================================================================
--
-- `check:live` sees the table and its column list (`LIVE_SCHEMA` gains an
-- entry, red until this file is applied). `probe:live-grants` sees the
-- absence of any table-level `authenticated` privilege (`MEASURED_TABLE_ACLS`
-- gains a row). NEITHER sees the trigger, its predicate or its function's
-- ACL; the live instrument for that half is the read-only catalog query in
-- `docs/access-model.md`'s #481 section (`pg_get_triggerdef`,
-- `pg_get_functiondef`, `has_function_privilege`), and the suite that runs
-- on every push is `src/test/assignmentHistory.pglite.test.js`.
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- `create table if not exists` with the constraints inline (skipped whole on
-- a re-run, `0030`'s shape), `create index if not exists`, `drop policy if
-- exists` before the policy, `create or replace` for the function, the
-- trigger dropped and re-created, grants and revokes idempotent by nature.
-- Nothing here replaces a function another file declares, so re-pasting any
-- older file leaves this one intact, and re-pasting this one changes nothing.

-- ---------------------------------------------------------------------------
-- 1. The record
-- ---------------------------------------------------------------------------

create table if not exists public.chore_assignment_history (
  id               uuid primary key default extensions.gen_random_uuid(),
  household_id     uuid not null references public.households (id) on delete cascade,
  chore_id         uuid not null,
  repeat_parent_id uuid,
  from_member_id   uuid,
  to_member_id     uuid,
  from_source      text,
  source           text,
  actor_member_id  uuid,
  period_start     date not null,
  recorded_at      timestamptz not null default now(),

  -- `0005`'s rule: the week key is a Monday or it is nothing. `isodow` is 1
  -- for Monday.
  constraint chore_assignment_history_period_is_week_start
    check (extract(isodow from period_start) = 1)
);

comment on table public.chore_assignment_history is
  'One append-only row per assignment change on a chore: who held it, who '
  'holds it now, how (manual / auto / completed), who did it, and the Monday '
  'of the week it landed in. Written only by the chores_record_assignment '
  'trigger; read by the household. The allocator reads the last weeks of it '
  'to steer a chore that keeps landing on one person, or keeps being moved '
  'off them after a deal-out. Story #481.';

comment on column public.chore_assignment_history.repeat_parent_id is
  'chores.generated_from at the time of the change: the key "the same chore '
  'across weeks" is read by, since a repeat''s occurrences are new rows. Null '
  'for a one-off chore, whose key is chore_id.';

comment on column public.chore_assignment_history.period_start is
  'The Monday of the week the change landed in, in the household''s zone — '
  'member_capacity''s key. Computed by the trigger from households.timezone.';

-- The read is "this household, the last few weeks", and this is its index.
create index if not exists chore_assignment_history_household_period_idx
  on public.chore_assignment_history (household_id, period_start);

-- ---------------------------------------------------------------------------
-- 2. The writer
-- ---------------------------------------------------------------------------

-- Definer, because the caller is an `authenticated` client with no insert
-- grant on the table — the record is bookkeeping the schema owns, not a
-- privilege the client holds. `0018`'s `note_split_inputs_changed` is the
-- precedent, on the same table.
create or replace function public.record_chore_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  week date;
begin
  select (date_trunc('week', now() at time zone h.timezone))::date
    into week
  from public.households h
  where h.id = new.household_id;

  insert into public.chore_assignment_history
    (household_id, chore_id, repeat_parent_id,
     from_member_id, to_member_id, from_source, source,
     actor_member_id, period_start)
  values
    (new.household_id, new.id, new.generated_from,
     old.assigned_member_id, new.assigned_member_id, old.assigned_source, new.assigned_source,
     public.acting_member(new.household_id), week);

  return null;
end;
$$;

comment on function public.record_chore_assignment() is
  'Trigger body for chores_record_assignment: appends one '
  'chore_assignment_history row for the update that fired it, stamping the '
  'household''s current week and the acting member. Story #481.';

-- `0022`'s reasoning: a trigger function needs no EXECUTE grant to fire, and
-- nothing in `public` is executable by `anon`. Revoked from `authenticated`
-- too — nothing calls this but the trigger.
revoke all on function public.record_chore_assignment() from public, anon, authenticated;

-- The predicate is the whole design; see the header's "WHEN IT FIRES".
drop trigger if exists chores_record_assignment on public.chores;
create trigger chores_record_assignment
  after update of assigned_member_id, assigned_source on public.chores
  for each row
  when (
    old.assigned_member_id is distinct from new.assigned_member_id
    or old.assigned_source is distinct from new.assigned_source
    or (new.assigned_source = 'auto'
        and old.completed_at is null
        and new.completed_at is null)
  )
  execute function public.record_chore_assignment();

-- ---------------------------------------------------------------------------
-- 3. Row-level security — which ROWS
-- ---------------------------------------------------------------------------

alter table public.chore_assignment_history enable row level security;

drop policy if exists chore_assignment_history_select_same_household
  on public.chore_assignment_history;
create policy chore_assignment_history_select_same_household
  on public.chore_assignment_history for select to authenticated
  using (household_id in (select public.current_household_ids()));

-- No insert, update or delete policy. The trigger runs as the owner and
-- bypasses row-level security, so a policy for it would be inert, and a
-- policy for `authenticated` would be a second way in for a write that must
-- have exactly one.

-- ---------------------------------------------------------------------------
-- 4. Privileges — which COLUMNS, and for whom
-- ---------------------------------------------------------------------------

-- The revoke first, naming `anon` beside `authenticated` for `0002`'s reason:
-- no policy above targets `anon`, but that is one `to anon` away from false.
revoke all on public.chore_assignment_history from authenticated, anon;

-- Every column, `household_id` included (the `0014` route — see the header).
-- One statement a reader can check against ASSIGNMENT_HISTORY_COLUMNS in
-- src/lib/assignmentHistory.js in one glance.
grant select (id, household_id, chore_id, repeat_parent_id,
              from_member_id, to_member_id, from_source, source,
              actor_member_id, period_start, recorded_at)
  on public.chore_assignment_history to authenticated;
