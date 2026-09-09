-- A refreshed calendar suggestion applies itself, within a bound — story #106.
--
-- `0031` let a member CONFIRM their calendar's suggestion into the week with
-- one tap (`source = 'calendar'`). This is the database half of the step the
-- owner decided on 2026-09-08, ahead of #100's live trust verdict and with the
-- tradeoff stated: when a calendar read lands and the suggestion is within
-- `AUTO_APPLY_BOUND_MINUTES` of the last figure a PERSON held for the week,
-- the client writes it with NOBODY tapping. Two things the row must then
-- carry that it could not before, and one word:
--
--   * `source = 'calendar_auto'` — the fourth word. A row nobody agreed to
--     has to be distinguishable from one somebody did (#57 AC 5's accuracy
--     question, and #106 AC 4's provenance), and the client's overwrite rule
--     reads it: the automatic path writes over NO row or over a calendar-set
--     row, never over `manual` or `extraction`, so the manual floor holds.
--   * `previous_minutes` — the last figure a person held for the week, the
--     ANCHOR: the baseline, a typed/described/confirmed figure, or the anchor
--     the previous automatic row was already carrying — never the automatic
--     figure it replaces. The client measures the bound from it and the
--     roster shows it as "set from calendar automatically (was N min)"
--     (#106 AC 4: the provenance AND the pre-change figure, both visible),
--     and because it is carried forward a chain of automatic writes cannot
--     walk a week further than one bound from what a person last held (owner
--     decision at the review escalation, 2026-09-08). Nullable, and legal
--     only on a `calendar_auto` row: a person's confirm or edit of that week
--     goes through the same upsert with the column set to null, which is how
--     a confirmed week stops claiming to have been automatic.
--
-- The bound and the delta it measures are the client's (`autoApplyDecision`
-- in src/lib/capacity.js, recorded in docs/capacity-model.md): the database
-- holds the inputs but not the fact that a calendar read just landed, so
-- enforcing the bound here would be a second design rather than a lookup.
-- THE ROWS IT MAY REPLACE ARE ENFORCED HERE, by the trigger in section 3b —
-- because that half the database CAN see (`old.source` is visible to a
-- `before update` trigger, and `0022` already puts one on this table), and
-- because the client's own check is a read followed by a write: a person's
-- figure landing in that one round trip would otherwise be overwritten by a
-- write nobody tapped, which is the trust-erosion kill condition by name.
-- Found by the review fan-out on this story's first draft, whose header said
-- "a decision the database cannot see" — false for this half, and the
-- sentence that would have stopped a later story from adding the trigger.
--
-- ===========================================================================
-- What this changes about who may do what
-- ===========================================================================
--
-- Three column grants and one trigger function. `select`, `insert` and
-- `update` on `previous_minutes` for `authenticated`, additive on `0005`'s and
-- `0022`'s sets. All three are the upsert's doing (`0022`'s lesson): PostgREST
-- names every payload column in its `DO UPDATE SET` (so UPDATE) and reads each
-- through `EXCLUDED` (so SELECT), and INSERT is the row's first write. The
-- column is provenance, not privilege — a client that lies about the previous
-- figure lies only to the roster it reads itself. `anon` is granted nothing
-- and `0017`'s revoke still stands. The trigger function is executable by
-- nobody, `0022`'s shape. No policy, no RPC.
--
-- `check:live` SEES this file, unlike `0031`: `CAPACITY_COLUMNS` now names
-- `previous_minutes`, so the `member_capacity` probe answers `42703` until
-- this is applied — one honest red, cleared by the apply. What it cannot see
-- is the constraint widening, for `0031`'s reason (a check constraint is not
-- a table, a column or a signature), so the read-only catalog query in
-- docs/access-model.md's `0039` entry is the instrument for that half, taken
-- on both sides of the apply.
--
-- ===========================================================================
-- Re-runnability, and the one thing a LATER paste of 0031 would do
-- ===========================================================================
--
-- Applied by `npm run migrate:live` or a hand paste; a re-paste of THIS file
-- is the normal path and is idempotent: `add column if not exists`, and the
-- two constraints are dropped and re-added rather than guarded, for `0029`'s
-- and `0031`'s reason — `member_capacity_source_known` ALREADY EXISTS with a
-- narrower definition, and an `if not exists` guard would read the old one as
-- present and leave the widening unapplied, the failure that looks like
-- success. Grants re-issue harmlessly.
--
-- RE-PASTING `0031` ON TOP OF THIS FILE NARROWS THE CONSTRAINT BACK TO THREE
-- WORDS — the `0012`/`0025`/`0026`-on-`0028` hazard, arriving here for the
-- first time on a constraint. `0031` drops the constraint by name and re-adds
-- its own definition, so a later paste of it reverts this file's widening.
-- Two things make that loud rather than silent: while any `calendar_auto`
-- row exists the re-add FAILS validation and `0031`'s paste errors out whole;
-- and `previous_minutes`, its grants, its own constraints and the trigger are
-- untouched either way, so the column stays while the word goes. The pglite
-- suite asserts both. Re-paste this file to restore the word. `0005`'s
-- create-table is skipped whole on a re-run, inline constraint included, so
-- it cannot narrow anything (`0031`'s test, still true here).

-- ---------------------------------------------------------------------------
-- 1. The constraint learns the fourth value
-- ---------------------------------------------------------------------------

alter table public.member_capacity
  drop constraint if exists member_capacity_source_known;

alter table public.member_capacity
  add constraint member_capacity_source_known
  check (source in ('manual', 'extraction', 'calendar', 'calendar_auto'));

-- ---------------------------------------------------------------------------
-- 2. The pre-change figure, legal only on an automatic row
--
-- Same range as `minutes` (`member_capacity_minutes_range`), because it IS a
-- capacity figure — the one the week had. Null is the ordinary state for the
-- three words a person wrote, and the second constraint is what makes a
-- confirm clear it: a client that upserts `source = 'calendar'` and forgets
-- to null the column is refused rather than leaving a confirmed week wearing
-- an automatic row's history.
-- ---------------------------------------------------------------------------

alter table public.member_capacity
  add column if not exists previous_minutes integer;

alter table public.member_capacity
  drop constraint if exists member_capacity_previous_minutes_range;

alter table public.member_capacity
  add constraint member_capacity_previous_minutes_range
  check (previous_minutes is null or (previous_minutes >= 0 and previous_minutes <= 10080));

alter table public.member_capacity
  drop constraint if exists member_capacity_previous_only_when_auto;

alter table public.member_capacity
  add constraint member_capacity_previous_only_when_auto
  check (previous_minutes is null or source = 'calendar_auto');

-- ---------------------------------------------------------------------------
-- 3. The grants — the upsert's three, per column, additive
-- ---------------------------------------------------------------------------

grant select (previous_minutes) on public.member_capacity to authenticated;
grant insert (previous_minutes) on public.member_capacity to authenticated;
grant update (previous_minutes) on public.member_capacity to authenticated;

-- ---------------------------------------------------------------------------
-- 3b. The manual floor, server-side: an automatic write never replaces a
--     figure a person set
--
-- `before update`, `0022`'s shape exactly. An INSERT has no `old` and needs no
-- check — there is no person's figure to protect. A PostgREST upsert that
-- conflicts fires this as an UPDATE, which is the only way an automatic write
-- can meet a standing row. `calendar` (a tap-confirmed calendar figure) and
-- `calendar_auto` may be replaced; `manual` and `extraction` may not. The
-- reverse — a person's word over an automatic row — is never refused: the
-- latest write wins for a person, `0005`'s rule.
--
-- Errcode `TA106`, the client's to recognise (`0018`'s `TA049` set the
-- convention): a refusal here means a person won the race, and the App treats
-- it as nothing-to-announce rather than as a fault. The message is worded for
-- a log, not a screen — no client sentence is built from it.
-- ---------------------------------------------------------------------------

create or replace function public.member_capacity_automatic_never_overtypes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source = 'calendar_auto' and old.source in ('manual', 'extraction') then
    raise exception
      'an automatic calendar figure cannot replace a figure a person set (%)', old.source
      using errcode = 'TA106';
  end if;
  return new;
end;
$$;

drop trigger if exists member_capacity_automatic_never_overtypes on public.member_capacity;
create trigger member_capacity_automatic_never_overtypes
  before update on public.member_capacity
  for each row execute function public.member_capacity_automatic_never_overtypes();

-- `0022`'s reasoning verbatim: a trigger function needs no EXECUTE grant to
-- fire, and nothing in `public` is executable by `anon`.
revoke all on function public.member_capacity_automatic_never_overtypes()
  from public, anon, authenticated;

comment on function public.member_capacity_automatic_never_overtypes() is
  'The server-side half of the manual floor (#106): refuses source = '
  'calendar_auto over a manual or extraction row with errcode TA106, so a '
  'person''s figure landing between the client''s re-read and its automatic '
  'write is kept. Never refuses a person''s word over anything.';

-- ---------------------------------------------------------------------------
-- 4. Say so where a reader of the catalog will look
-- ---------------------------------------------------------------------------

comment on column public.member_capacity.source is
  'Where this week''s figure came from: manual (typed), extraction (a '
  'plain-language description, #210), calendar (a confirmed free/busy '
  'suggestion, #97) or calendar_auto (a free/busy suggestion the app applied '
  'within the client''s bound with nobody tapping, #106). A calendar figure '
  'the member edited before saving is manual; an extraction figure they '
  'edited stays extraction; a calendar_auto figure saved unedited is a '
  'confirm and becomes calendar.';

comment on column public.member_capacity.previous_minutes is
  'The last figure a person held for this week before the automatic calendar '
  'writes began — baseline, a typed/described/confirmed figure, or the anchor '
  'the previous automatic row carried — so the roster can show what changed '
  'without anybody having tapped, and so the client measures its bound from a '
  'person''s figure rather than from the last automatic step. Null unless '
  'source is calendar_auto (enforced). Story #106.';
