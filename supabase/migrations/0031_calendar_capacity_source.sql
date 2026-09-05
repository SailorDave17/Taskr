-- A confirmed calendar suggestion is a capacity source — story #97.
--
-- `0030` stored what a member's calendar says about a week, and #96 drew it
-- beside this week's minutes as a READOUT with no control on it. This is the
-- one line the database needs before that readout can become a figure the
-- member accepts: `member_capacity.source` learns a third value, `calendar`.
--
-- ===========================================================================
-- Why a third value and not 'manual'
-- ===========================================================================
--
-- `source` exists so a later accuracy question is answerable from the data
-- (#57 AC 5): a figure a person typed and a figure a machine proposed must
-- stay distinguishable downstream, or nobody can ever ask whether the machine
-- was any good. `extraction` is the plain-language proposer's word (#210);
-- `calendar` is this one's. The rule the client applies is the mirror of
-- #210's, and it is a decision rather than an accident: a calendar figure is
-- ARITHMETIC on a number the member can see (max(0, baseline - busy), owner
-- decision at the groom gate, 2026-08-16), so a figure the member changed is no
-- longer the calendar's and saves as `manual`; a description's figure is an
-- INTERPRETATION of what the member wrote, so a corrected one is still derived
-- from the description and keeps `extraction` (#210 AC 6).
--
-- ===========================================================================
-- What this does NOT change
-- ===========================================================================
--
-- No column, no grant, no policy, no function. `source` is already in the
-- column lists `0005` grants for select, insert and update, and the client
-- already writes it (`setCapacity` in src/lib/capacity.js has carried a
-- `source` argument since #210). Nothing about who may read or write a
-- capacity row moves; only the set of words the row may hold. A client on a
-- project without this file is refused by the constraint the moment a member
-- confirms a calendar figure — loudly, naming `member_capacity_source_known` —
-- which is the failure this story's `check:live` blindness note is about:
-- that check probes tables, columns and signatures, and this file changes
-- none of them.
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- Applied by `npm run migrate:live` or a hand paste; a re-paste is the normal
-- path. The constraint is DROPPED and re-added rather than guarded by a
-- catalog lookup, for `0029`'s reason: it ALREADY EXISTS with a narrower
-- definition, so an `if not exists` guard would read the old constraint as
-- present and leave the widening unapplied — the failure that looks like
-- success. Dropping a check constraint and adding it back holds an ACCESS
-- EXCLUSIVE lock for the validation scan, which on this table is milliseconds.
--
-- Re-pasting `0005` on top of this file does NOT revert it: `0005` declares
-- the constraint inline in a `create table if not exists`, and on a re-run the
-- whole statement is skipped, inline constraints with it. A test asserts that,
-- because it is the opposite of what a re-paste of `0012`/`0025`/`0026` does to
-- `0028` and a reader who has learned that hazard would reasonably expect it
-- here.

-- ---------------------------------------------------------------------------
-- 1. The constraint learns the third value
-- ---------------------------------------------------------------------------

alter table public.member_capacity
  drop constraint if exists member_capacity_source_known;

alter table public.member_capacity
  add constraint member_capacity_source_known
  check (source in ('manual', 'extraction', 'calendar'));

-- ---------------------------------------------------------------------------
-- 2. Say so where a reader of the catalog will look
-- ---------------------------------------------------------------------------

comment on column public.member_capacity.source is
  'Where this week''s figure came from: manual (typed), extraction (a '
  'plain-language description, #210) or calendar (a confirmed free/busy '
  'suggestion, #97). A calendar figure the member edited before saving is '
  'manual; an extraction figure they edited stays extraction.';
