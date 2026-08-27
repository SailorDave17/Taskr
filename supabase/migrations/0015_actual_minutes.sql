-- Expected-vs-actual time capture — story #12.
--
-- A chore records how long it REALLY took, beside — never instead of — how
-- long it was expected to take. `expected_minutes` is the unit the fairness
-- split divides (0003's invariant); `actual_minutes` is what feedback and the
-- done-work display read. The two are distinct columns and nothing here ever
-- writes one from the other after completion, so an estimate corrected later
-- cannot rewrite history and a recorded actual cannot leak into the
-- allocation input — the conflation that produced the legacy defect #12's
-- story text names.
--
-- ===========================================================================
-- The zero-tap default is seeded at completion, by the function
-- ===========================================================================
--
-- Owner decision, 2026-08-26 (recorded in docs/refresh-charter.md's decision
-- log): marking a chore done stays ONE tap, and `complete_chore` seeds
-- `actual_minutes = expected_minutes` when no actual has been recorded yet.
-- Doing nothing therefore stores honest data — the estimate stands as the
-- best available claim of what the work cost — and a member who wants to say
-- otherwise adjusts the value on the done row afterwards.
--
-- The seed is `coalesce(actual_minutes, expected_minutes)`, not a plain
-- overwrite, and the difference is AC 1's reopen clause: a chore marked done,
-- adjusted to 35 minutes, reopened ("not done after all") and completed again
-- keeps its 35 — `uncomplete_chore` clears the completion facts and leaves
-- the actual alone, so re-completing must not stamp the estimate back over a
-- number a person entered.
--
-- ===========================================================================
-- Why the adjustment path is a plain column grant, when completion is not
-- ===========================================================================
--
-- `completed_at` moves only through the function because of the CLOCK — a
-- client timestamp could move work between weeks (0004). An actual has no
-- such integrity argument: it is a member's own claim about their own time,
-- the household is the trust boundary, and no derived rule keys off it that a
-- forged value could subvert (allocation reads `expected_minutes` only —
-- #12 AC 5, pinned in src/lib/allocation.test.js). So adjustment is an
-- ordinary column-granted update, 0003's additive-by-column convention.
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- Applied by a human pasting into the Supabase SQL editor. `add column if not
-- exists`, the constraint guarded by a catalog check (an ALTER-added
-- constraint has no inline idempotent form — 0012's pattern), and
-- `create or replace` on a function whose signature DOES NOT CHANGE — same
-- argument set, so no overload appears and PostgREST's name-set resolution
-- (which `check:live` probes) is untouched.

-- ---------------------------------------------------------------------------
-- Column
-- ---------------------------------------------------------------------------

alter table public.chores
  add column if not exists actual_minutes integer;

-- Named because the test asserts against the name. Null is legal — it means
-- "never completed, and nobody has claimed a time". ZERO is legal too, and
-- that is a deliberate difference from `chores_expected_minutes_range`: a
-- zero ESTIMATE cannot be allocated against a budget of minutes, but "it took
-- no time — it was already done" is a real household fact, and
-- allocation.test.js (#47 criterion 7) already pins that a recorded zero
-- contributes zero. Refusing it would make the app argue with someone
-- reporting the single most useful datum this story collects.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chores_actual_minutes_range') then
    alter table public.chores add constraint chores_actual_minutes_range
      check (actual_minutes is null or actual_minutes between 0 and 1440);
  end if;
end $$;

comment on column public.chores.actual_minutes is
  'How long the work really took, in minutes. Seeded to expected_minutes by '
  'complete_chore when null (the zero-tap honest default), adjustable by any '
  'household member. Survives uncomplete_chore, so a reopened chore retains '
  'its recorded time. Read by feedback and the done-work display; never read '
  'by allocation, which consumes expected_minutes only. Story #12.';

-- ---------------------------------------------------------------------------
-- complete_chore seeds the default
-- ---------------------------------------------------------------------------

-- Identical to 0007's version except the one `actual_minutes` line. Same
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
         -- The zero-tap default: doing nothing records the estimate as the
         -- best claim of the cost. Coalesce, so a retained actual from an
         -- earlier completion is never stamped over.
         actual_minutes = coalesce(chores.actual_minutes, chores.expected_minutes)
   where id = chore_id
  returning * into target;

  return target;
end;
$$;

-- `uncomplete_chore` is deliberately untouched: it clears `completed_at` and
-- the attribution and must leave `actual_minutes` standing (AC 1's reopen
-- clause). Restating it here would be a second copy that can drift.

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- The additive-by-column convention from 0003, re-issued in full so one
-- statement lists every readable column (0004's argument). New and readable:
-- `actual_minutes`. `household_id` entered the readable set in 0014; the
-- watermark columns stay withheld for 0012's reasons.
grant select (id, household_id, title, expected_minutes, due_on, created_at,
              completed_at, completed_by_member_id, assigned_member_id,
              repeat_kind, repeat_weekdays, generated_from, actual_minutes)
  on public.chores to authenticated;

-- Adjustable after the fact — the reasoning block above. NOT added to the
-- insert grant: an actual on a chore that has not been done yet is a claim
-- about work that has not happened, and the seed at completion is the only
-- way a value first appears without a person typing one.
grant update (actual_minutes) on public.chores to authenticated;
