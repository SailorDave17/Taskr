-- A week's budget suggested from the last weeks' completions is a capacity
-- source — story #480.
--
-- `member_capacity.source` learns a fifth word, `suggested`: a person tapped
-- "Use this" on a figure computed from what they actually completed over the
-- last four weeks, adjusted by this week's calendar and work hours
-- (`suggestCapacity` in src/lib/capacity.js, the rule and its constants in
-- docs/capacity-model.md), and saved it UNEDITED. Edited first, it saves as
-- `manual` — `calendar`'s rule (#97 AC 2), for `calendar`'s reason: the
-- figure is arithmetic on numbers the person can see, so a figure they
-- changed is no longer the suggestion's.
--
-- ===========================================================================
-- Why a fifth word, and why the trigger learns it too
-- ===========================================================================
--
-- `source` exists so a later accuracy question is answerable from the data
-- (#57 AC 5), and this story's last criterion IS that question: after two
-- weeks on the deployed build, the suggestion is compared per member with
-- what they then completed, and a miss over 50% for most members in both
-- weeks reopens the story. A row that said `manual` could not be found again.
--
-- The trigger `0039` added, `member_capacity_automatic_never_overtypes`, is
-- re-declared here to refuse `calendar_auto` over a `suggested` row as well as
-- over `manual` and `extraction`. The story's rule is that this figure is
-- OFFERED and never auto-applied — #106's bound was argued for a figure the
-- calendar computed, not one that reads a person's own past back at them —
-- and the client half of that (`isCalendarSourced` says no to `suggested`, so
-- `autoApplyDecision` refuses over the row as person-set) needs its server
-- half for `0039`'s reason: the client's check is a read followed by a write,
-- and a `suggested` row landing in that round trip would otherwise be
-- overwritten with nobody tapping. Same errcode, `TA106`; the App already
-- reads it as "a person won".
--
-- ===========================================================================
-- What this does NOT change
-- ===========================================================================
--
-- No column, no grant, no policy. `check:live` and `probe:live-grants` are
-- blind to this file in BOTH directions, `0031`'s and `0044`'s reason — a
-- check constraint and a trigger body are not a table, a column, a signature
-- or a grant — so the instrument is the read-only catalog query in
-- docs/access-model.md's `0046` entry, taken on both sides of the apply:
-- `pg_get_constraintdef` for `member_capacity_source_known` (four words
-- before, five after) and `pg_get_functiondef` for the trigger function
-- (`'suggested'` absent from its `in (...)` before, present after).
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- `0039`'s shape exactly. The constraint is DROPPED and re-added rather than
-- guarded, because it already exists with a narrower definition and an `if
-- not exists` guard would read the old one as present and leave the widening
-- unapplied — the failure that looks like success. The function is `create or
-- replace`; the trigger is dropped and recreated; the revoke and the comments
-- re-issue harmlessly.
--
-- RE-PASTING `0039` ON TOP OF THIS FILE NARROWS THE CONSTRAINT BACK TO FOUR
-- WORDS and the trigger back to two — the `0031`-on-`0039` hazard, moved one
-- file on. While any `suggested` row exists the constraint re-add FAILS
-- validation and `0039`'s paste errors out whole, which is the loud half; the
-- trigger would narrow silently, which is why the pglite suite asserts the
-- refusal over a `suggested` row on a database built through THIS file and
-- not merely that the word is admitted. Re-paste this file to restore both.

-- ---------------------------------------------------------------------------
-- 1. The constraint learns the fifth value
-- ---------------------------------------------------------------------------

alter table public.member_capacity
  drop constraint if exists member_capacity_source_known;

alter table public.member_capacity
  add constraint member_capacity_source_known
  check (source in ('manual', 'extraction', 'calendar', 'calendar_auto', 'suggested'));

-- ---------------------------------------------------------------------------
-- 2. The manual floor learns that a suggested week is a person's
-- ---------------------------------------------------------------------------

create or replace function public.member_capacity_automatic_never_overtypes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source = 'calendar_auto' and old.source in ('manual', 'extraction', 'suggested') then
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
  'The server-side half of the manual floor (#106, widened by #480): refuses '
  'source = calendar_auto over a manual, extraction or suggested row with '
  'errcode TA106, so a person''s figure landing between the client''s re-read '
  'and its automatic write is kept. Never refuses a person''s word over anything.';

-- ---------------------------------------------------------------------------
-- 3. Say so where a reader of the catalog will look
-- ---------------------------------------------------------------------------

comment on column public.member_capacity.source is
  'Where this week''s figure came from: manual (typed), extraction (a '
  'plain-language description, #210), calendar (a confirmed free/busy '
  'suggestion, #97), calendar_auto (a free/busy suggestion the app applied '
  'within the client''s bound with nobody tapping, #106) or suggested (a '
  'figure built from the last weeks'' completions and this week''s calendar, '
  'taken with one tap, #480). A calendar or suggested figure the member '
  'edited before saving is manual; an extraction figure they edited stays '
  'extraction; a calendar_auto figure saved unedited is a confirm and becomes '
  'calendar.';
