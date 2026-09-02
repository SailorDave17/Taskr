-- A missed occurrence of a repeating chore does not stack up — story #306.
--
-- Until this file the catch-up pass (0012, replaced by 0025 and 0026) created
-- every missed occurrence inside the bound — up to seven rows for a daily
-- repeat — and left each one outstanding with a past `due_on`. The Chores tab
-- listed all of them, oldest first, and `isOutstanding` counted every one in
-- the "still to do" minutes and in its holder's load on the Split: a member
-- who let a 20-minute daily slip for five days was shown 100 minutes of
-- overdue work that can no longer be done, and the fairness figure — the
-- charter's "argument ends" number — was computed over it. The only exits
-- from an overdue copy were Done, which credits work that did not happen,
-- and Remove, which destroys the history #105 keeps on purpose. #305 added
-- the honest exit (the missed state); this file is its automatic writer.
--
-- ===========================================================================
-- The rule — owner decision 2026-09-02, recorded on #306
-- ===========================================================================
--
-- When the pass CREATES a new occurrence for an anchor, every OUTSTANDING
-- member of that anchor's family with an OLDER `due_on` is marked missed —
-- the state 0027 introduced — with the pass's own clock. It leaves the list
-- and counts toward nobody. The rule keys on the anchor, not the kind, so
-- daily, weekly and monthly behave alike: a daily goes missed on the next app
-- open, a weekly's window is its week, a monthly's is its month. That window
-- is the stated cost of the chosen rule, written down so it is not later
-- rediscovered as a defect: an overdue weekly sits on the list and in the
-- Split for up to seven days, a monthly for up to a month, until its
-- successor generates.
--
-- The FAMILY is the anchor row plus the occurrences generated from it. The
-- anchor's own `due_on` is the first occurrence (0012's design — the pass
-- generates strictly after it, and its completion counts in #12's actuals),
-- so an anchor nobody ever ticked is superseded by its first generated
-- occurrence exactly as that occurrence is superseded by the next. Leaving
-- the anchor out would keep one permanent overdue row per repeat, which is
-- the stacking in miniature.
--
-- THE COST OF THAT, kept by the owner on 2026-09-02 after #306's review
-- raised it: the anchor is the only row carrying a repeat's schedule controls
-- (the badge, Edit-schedule, #105's Skip, the estimate offer — a generated
-- occurrence renders none, #53 AC 7), and once superseded it sits on the Done
-- surface under the week it was superseded, PERMANENTLY, because a superseded
-- row keeps its first stamp. So a repeat whose first day was never ticked has
-- those controls behind a collapsed old week. A completed anchor already lived
-- on Done under an old week before this file; the rule extends that reach and
-- does not create it. Rejected: excluding the anchor (above), and widening
-- this story to move the controls. The repair is #311 — a repeat's schedule
-- controls reachable from its newest outstanding occurrence.
--
-- Rejected on the issue: collapsing the overdue copies into one row with a
-- count — a tally on a person's chore reads as a shame mechanic, and it would
-- still need the missed state underneath to mean anything; and deleting the
-- superseded rows — they are the history #105 keeps and the record #12's
-- actuals may one day want, and a missed row is honest where an absent one
-- is silent. Rejected at the same decision: marking missed at the end of the
-- due day for every kind (a weekly done a day late would read not-done first
-- and Done-wins second, showing more misses than the household would feel it
-- earned) and a per-kind grace window (a third tunable plus copy on the edit
-- form, for a distinction the per-anchor rule already approximates).
--
-- ===========================================================================
-- Why it is a step of the pass, not a trigger and not a client rule
-- ===========================================================================
--
-- The generator already holds the anchor row `for update`, already knows the
-- household's clock, and already decides which dates exist. Doing the
-- supersede in the same block means the write happens under the same lock
-- and with the same instant as the rows that supersede — one transaction, no
-- window in which both the old copy and the new one are outstanding for a
-- phone to read. The client learns nothing beyond what 0027 already taught
-- `isOutstanding`: a row carrying `missed_at` has left the list. `0018`'s
-- row-level trigger bumps `assignments_version` on every superseded row,
-- exactly as it does for the rows the pass inserts, so a re-assignment
-- computed over the stacked copies is refused as stale.
--
-- The stamp is `as_of` — the instant the pass runs for — rather than a second
-- reading of `now()`. For the client surface (`catch_up_repeats()`, 0012) the
-- two are the same value; for the held-instant form the suite drives, `as_of`
-- IS the clock the pass is being asked about, so the Done surface files the
-- row under the week of the pass that superseded it (#302 groups on
-- `missed_at`, in the household's zone).
--
-- What the step does NOT touch, each proven in superseded.pglite.test.js:
--
--   * A COMPLETED superseded occurrence — completed work is history (#105's
--     ratified rule). 0027's CHECK would refuse both stamps anyway, so a rule
--     reaching a completed row would RAISE rather than quietly lie, which is
--     the right failure for a rule that has lost its predicate.
--   * A row ALREADY missed — the first stamp stands (`missed_at is null`),
--     for the reason `miss_chore` coalesces: a later pass must not move the
--     row between weeks on the Done surface.
--   * An ASSIGNED superseded occurrence keeps its assignment as a record;
--     `toAllocatorChores` drops a missed row, so it contributes nothing to
--     the Split. The new occurrence generates unassigned, as it always has.
--   * A ONE-OFF chore past its due date — it has no anchor and nothing
--     supersedes it; the update is scoped to the anchor's own family.
--   * A row a member PUT BACK (`unmiss_chore`, 0027) while a newer occurrence
--     was outstanding — the step runs only when THIS pass created something
--     for the anchor, so a put-back row stays on the list until the next
--     occurrence actually generates and supersedes it again. Re-missing it on
--     every open would fight a deliberate tap.
--
-- ===========================================================================
-- The household is NOT told — owner decision 2026-09-02, at #306's pickup
-- ===========================================================================
--
-- #53 AC 4's skipped-occurrences notice announces work that NEVER APPEARED
-- because nobody opened the app for longer than the bound; silence there
-- would hide a real absence. A superseded occurrence has not vanished: it is
-- on the Done surface labelled "not done", with "Put it back" beside it. A
-- transient "N marked not done" would fire on most opens for any household
-- with a daily repeat — a daily nag about work that did not happen, the tone
-- the charter's no-shame direction rules out — and it would need a third
-- return column, which `create or replace` cannot add (a changed return type
-- is a DROP, of both catch-up functions and the privileges 0012 set on them).
-- So the pass's return shape is unchanged, `skipped_count` still counts only
-- what the bound skipped, and no sentence is added. The alternatives (extend
-- the notice; say it only beside a skip) are recorded as rejected in
-- docs/refresh-charter.md's decision log, beside this decision.
--
-- ===========================================================================
-- Re-runnability, and the same ordering hazard 0025 and 0026 name
-- ===========================================================================
--
-- Applied by `npm run migrate:live` or a hand paste; a re-paste is the normal
-- path. This file is ONE `create or replace function` with an unchanged
-- signature and an unchanged return type — a true replace, no overload — and
-- two `comment on`s (the function's, and a restatement of `missed_at`'s,
-- because 0027's says "Set only by miss_chore" and this file makes the pass a
-- writer — the same one-clause repair 0026 made for `repeat_kind`; 0027's own
-- text stays as it was, historical by this repo's convention). The ACLs
-- `0012` set on `catch_up_repeats_at` (granted to no client role) survive a
-- replace, so no privilege statement is re-issued; superseded.pglite.test.js
-- reads them back rather than trusting this line.
--
-- THE HAZARD: `0012`, `0025` and `0026` each carry their own
-- `catch_up_repeats_at`, so re-pasting ANY of them on top of this file
-- SILENTLY REVERTS the supersede step — the paste succeeds, the pass keeps
-- generating, and overdue copies start stacking again with nothing reporting
-- it. `0026`'s header grades the two older ones (0012 degrades to a
-- monthly-blind pass; 0025 breaks every kind); a re-pasted `0026` is the
-- quietest of the three, because it leaves everything working except this
-- rule. `check:live` cannot see any of it: it probes a function by name and
-- argument set, and this file changes neither, so it reads the same on both
-- sides of this apply and on both sides of the reversion. The repair for all
-- three is re-pasting THIS file; the whole-list-in-order re-run stays safe,
-- which is what `migrations.pglite.test.js` proves and what
-- superseded.pglite.test.js proves for this step specifically — the whole
-- list re-applied keeps the step, and each of the three older files re-pasted
-- on top of this one succeeds, leaves one function and removes it. MEASURED,
-- three arms, not reasoned from these paragraphs.

-- ---------------------------------------------------------------------------
-- 1. The catch-up pass supersedes what it would otherwise stack on
-- ---------------------------------------------------------------------------

-- `0026`'s body — the kind-dependent bound, exceptions honoured in both the
-- insert and the skipped count, the monthday passed to both schedule calls —
-- with three additions: `made` also returns the date it created, the newest
-- of those is read beside the count, and the update after the count is the
-- supersede step. Everything else is byte-for-byte 0026, and the comments
-- explaining the shape stay with 0012, 0025 and 0026.
create or replace function public.catch_up_repeats_at(as_of timestamptz)
returns table (created_count integer, skipped_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Daily and weekly: the 2026-08-24 owner decision, unchanged.
  catch_up_bound_days constant integer := 7;
  -- Monthly: one interval — owner decision 2026-08-31, reasoned in 0026's
  -- header. A separate constant rather than a day count, because "one month"
  -- is not a fixed number of days.
  catch_up_bound_months constant integer := 1;

  caller uuid := (select auth.uid());
  parent record;
  today_local date;
  after_anchor date;
  bound_floor date;
  made_now integer;
  -- #306: the newest date THIS pass created for the anchor; null when it
  -- created nothing, in which case nothing is superseded.
  newest_made date;
  skipped_now integer;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  created_count := 0;
  skipped_count := 0;

  for parent in
    select c.id, c.household_id, c.title, c.expected_minutes, c.due_on,
           c.repeat_kind, c.repeat_weekdays, c.repeat_monthday, c.repeat_since,
           c.repeat_caught_up_through, h.timezone
    from public.chores c
    join public.households h on h.id = c.household_id
    where c.repeat_kind <> 'none'
      and c.household_id in (select public.current_household_ids())
    order by c.created_at, c.id
    for update of c
  loop
    today_local := (as_of at time zone parent.timezone)::date;

    after_anchor := greatest(
      parent.due_on,
      parent.repeat_since,
      coalesce(parent.repeat_caught_up_through, parent.repeat_since)
    );

    -- The oldest date this pass may CREATE, per kind. `+ 1` in both arms so
    -- the window is inclusive of its own floor: seven days means today and
    -- the six before it, one month means today and everything back to the
    -- same day-of-month last month.
    bound_floor := case
      when parent.repeat_kind = 'monthly'
        then (today_local - make_interval(months => catch_up_bound_months))::date + 1
      else today_local - catch_up_bound_days + 1
    end;

    with made as (
      insert into public.chores
        (household_id, title, expected_minutes, due_on, generated_from)
      select parent.household_id, parent.title, parent.expected_minutes,
             occurrence.d, parent.id
      from public.repeat_occurrence_dates(
             parent.repeat_kind, parent.repeat_weekdays, parent.repeat_monthday,
             greatest(after_anchor, bound_floor - 1), today_local
           ) as occurrence(d)
      where not exists (
        select 1 from public.chore_repeat_exceptions e
        where e.chore_id = parent.id and e.excluded_on = occurrence.d
      )
      on conflict (generated_from, due_on) where generated_from is not null
      do nothing
      returning id, due_on
    ),
    copied as (
      insert into public.chore_exclusions (household_id, chore_id, member_id)
      select parent.household_id, made.id, x.member_id
      from made
      join public.chore_exclusions x on x.chore_id = parent.id
      returning 1
    )
    select count(*), max(made.due_on) into made_now, newest_made from made;

    -- #306: what this pass just created supersedes every outstanding member
    -- of the anchor's family dated before it — the anchor row included, since
    -- its own due_on is the first occurrence. Only when something WAS created:
    -- a pass that made nothing changes nothing, which is what lets "Put it
    -- back" hold until the next occurrence really arrives. Completed rows are
    -- history, and an already-missed row keeps its first stamp.
    --
    -- The `if` is the stated guard and it has a SPARE: when nothing was made,
    -- `newest_made` is null, and `due_on < null` is null, so the update would
    -- match no row even without it. *Measured* in #306's mutation pass —
    -- removing either guard alone reddens nothing, removing both reddens the
    -- put-back test and the weekly mid-week test. The `if` stays because it
    -- says what is meant; the null comparison is three-valued logic doing the
    -- same job by accident, and a reader should not have to notice that.
    if made_now > 0 then
      update public.chores
         set missed_at = as_of
       where public.chores.household_id = parent.household_id
         and (public.chores.id = parent.id or public.chores.generated_from = parent.id)
         and public.chores.due_on < newest_made
         and public.chores.completed_at is null
         and public.chores.missed_at is null;
    end if;

    select count(*) into skipped_now
    from public.repeat_occurrence_dates(
           parent.repeat_kind, parent.repeat_weekdays, parent.repeat_monthday,
           after_anchor, bound_floor - 1
         ) as occurrence(d)
    where not exists (
      select 1 from public.chore_repeat_exceptions e
      where e.chore_id = parent.id and e.excluded_on = occurrence.d
    );

    update public.chores
       set repeat_caught_up_through = today_local
     where public.chores.id = parent.id
       and (repeat_caught_up_through is null
            or repeat_caught_up_through < today_local);

    created_count := created_count + made_now;
    skipped_count := skipped_count + skipped_now;
  end loop;

  return next;
end;
$$;

comment on function public.catch_up_repeats_at(timestamptz) is
  'Internal form of catch_up_repeats, taking the instant so the suite can '
  'hold the clock; clients get catch_up_repeats(). Creates each anchor''s '
  'occurrences inside the kind-dependent bound (#53, #103), honours skipped '
  'dates (#105), and marks every older outstanding member of the anchor''s '
  'family missed when a newer occurrence is created (#306).';

-- 0027's comment on this column says "Set only by miss_chore", and from this
-- file on the catch-up pass sets it too. A migration is not edited after it
-- is applied, so the repair is a restatement here — exactly what 0026 did for
-- `repeat_kind` when monthly joined the kinds. Every other clause of 0027's
-- sentence stays as it was.
comment on column public.chores.missed_at is
  'When the chore was recorded as not done, by the database''s clock. Null '
  'means it was not recorded as missed. Set by miss_chore, or by '
  'catch_up_repeats_at when a newer occurrence of the same repeat supersedes '
  'the row (#306); cleared by unmiss_chore or by complete_chore (done wins). '
  'A missed chore contributes no load, no actual and no credit to anybody. '
  'Mutually exclusive with completed_at. Stories #305 and #306.';

-- `create or replace` preserves the ACLs `0012` set on `catch_up_repeats_at`
-- (granted to no client role), so no privilege statement is re-issued here —
-- and the suite reads that back rather than trusting this sentence.
