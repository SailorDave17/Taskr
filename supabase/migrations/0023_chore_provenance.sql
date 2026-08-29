-- Where a chore came from — story #211.
--
-- A chore records whether a person TYPED it or an extraction proposed it. The
-- column carries no privilege and decides nothing: it is provenance, and it
-- exists so that a later question — "how accurate was chore extraction in
-- practice?" — is answerable from the data rather than from memory.
--
-- That question is not idle curiosity. `docs/refresh-charter.md` makes trust in
-- extracted numbers a KILL CONDITION for the extraction bet (epic #217), and a
-- kill condition nothing measures is a sentence rather than a test. Without this
-- column the evidence for keeping or killing that bet would have to be
-- reconstructed from recollection, which is exactly the reconstruction the
-- charter says it will not accept.
--
-- ===========================================================================
-- Why `source` and not a new spelling
-- ===========================================================================
--
-- `member_capacity` has carried `source text not null default 'manual'` with a
-- `check (source in ('manual', 'extraction'))` since `0005`, for the same reason
-- and against the same future question. This file copies that shape exactly —
-- same column name, same type, same default, same two values, same constraint
-- naming convention — so the two provenance columns can be read, joined and
-- reasoned about as one idea. A second spelling here (`origin`, `entered_via`,
-- `capture_source`) would have been a fact about who wrote which migration.
--
-- ===========================================================================
-- The name collision this file walks into, stated rather than discovered
-- ===========================================================================
--
-- `chores` ALREADY has `assigned_source` (`0018`, story #49), and the two are
-- different facts about different events:
--
--   source           how the CHORE came to exist      'manual' | 'extraction'
--   assigned_source  how the ASSIGNMENT was decided   'manual' | 'auto' | null
--
-- They are not variants of one another and neither can be derived from the
-- other: a typed chore can be auto-assigned, and an extracted chore can be
-- assigned by hand. The vocabularies deliberately do not overlap — 'extraction'
-- is never an assignment and 'auto' is never a capture — so a value read out of
-- the wrong column is a wrong ANSWER rather than a plausible one, and the check
-- constraints here and in `0018` each refuse the other's words.
--
-- This is written down because the risk is not a bug, it is a later reader
-- taking `assigned_source` for the provenance column because it is the one whose
-- name contains the word they searched for.
--
-- ===========================================================================
-- Why NOT NULL with a default, when `assigned_source` is nullable
-- ===========================================================================
--
-- `assigned_source` is nullable because a chore genuinely may have no
-- assignment, so there is a third state to represent. A chore always came from
-- somewhere: there is no chore whose origin is unknown going forward, and every
-- chore that exists TODAY was typed, because no extraction path has ever been
-- built — `src/lib/extraction.js` scores proposals and writes nothing. So the
-- default backfills every existing row with a true statement rather than a
-- placeholder, and this is one of the few backfills in this directory that is a
-- FACT rather than a guess.
--
-- That is also why there is no separate `update ... where source is null`
-- statement below. Postgres fills existing rows from the DEFAULT as part of the
-- ADD COLUMN, so a backfill reading a column added above it would match nothing
-- — the no-op shape `0018`'s header warns about, arriving here as a statement
-- correctly NOT written.
--
-- ===========================================================================
-- Privileges — readable, settable at insert, never updatable
-- ===========================================================================
--
-- A client MAY set it, exactly as it may for `member_capacity`: this is
-- provenance rather than privilege, and the client is the only party that knows
-- which path the chore took. It is in the SELECT and INSERT grants and in
-- NOTHING else — deliberately not UPDATE, which is where this file departs from
-- `0005`.
--
-- The reason for the departure is that the two columns answer differently-shaped
-- questions. A capacity override is one row per person per week CORRECTED in
-- place (`0005`'s unique constraint makes a second declaration an update, so its
-- source has to move with it, or a correction typed by hand would go on saying
-- 'extraction'). A chore's origin is a fact about an event that has already
-- happened and cannot be re-run: editing a chore's title later does not change
-- where the chore came from. Making it updatable would let a screen that meant
-- to fix a typo silently rewrite the only evidence the accuracy question has.
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- Applied either by `npm run migrate:live` or by a human pasting into the
-- Supabase SQL editor, and a second application is the normal path rather than
-- an edge case. `add column if not exists`; the constraint guarded by a catalog
-- check, because an ALTER-added constraint has no inline idempotent form
-- (`0012`'s pattern, inherited by `0015` and `0018`); `comment on` and `grant`
-- are both naturally idempotent.
--
-- One thing this file deliberately does NOT contain: a `create or replace
-- function`. Such a statement always succeeds and can silently reinstate a body
-- a later migration re-pointed, which is the one way a "re-runnable" file in this
-- directory has been measured to do harm — `0004` and `0006` do exactly that if
-- re-pasted today. There is nothing here but a column, a constraint, a comment
-- and two grants, so re-running it is inert against every schema version from
-- `0022` forward.

-- ---------------------------------------------------------------------------
-- Column
-- ---------------------------------------------------------------------------

alter table public.chores
  add column if not exists source text not null default 'manual';

-- Named because the test asserts against the name. Postgres generates its own
-- message text and that text is not a contract — asserting against it would make
-- the test pass or fail on a Postgres version rather than on the rule (0003's
-- reasoning, applied again).
--
-- The vocabulary is CLOSED at two values on purpose. A third path — an import, a
-- chore shared from another household — is a story nobody has written, and
-- widening this constraint is the cheapest possible edit when somebody does.
-- Leaving it open now would let the column hold a word nothing in the app can
-- read, and the accuracy question would have to guess what it meant.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chores_source_known') then
    alter table public.chores add constraint chores_source_known
      check (source in ('manual', 'extraction'));
  end if;
end $$;

comment on column public.chores.source is
  'How the chore came to exist: manual (a person typed it) or extraction (a '
  'proposal accepted from plain-language capture). Provenance, never privilege '
  '- it grants nothing and no rule keys off it. Distinct from assigned_source, '
  'which records how the ASSIGNMENT was decided and shares no vocabulary with '
  'this column. Mirrors member_capacity.source (0005). Story #211.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- Both grants are re-issued IN FULL with the new column rather than added
-- narrowly, which is 0018's convention and 0012's before it: one statement a
-- reader can check against CHORE_COLUMNS in src/lib/chores.js in a single
-- glance. A narrow `grant select (source)` would be equivalent to Postgres and
-- would leave the authoritative list spread across five files.

grant select (id, household_id, title, expected_minutes, due_on, created_at,
              completed_at, completed_by_member_id, assigned_member_id,
              repeat_kind, repeat_weekdays, generated_from, actual_minutes,
              assigned_source, source)
  on public.chores to authenticated;

-- A chore is CREATED with its origin, so `source` joins the insert set. It is
-- absent from the update grant, and chores.pglite.test.js proves that refusal
-- rather than leaving the absence to be inferred from this comment.
grant insert (household_id, title, expected_minutes, due_on,
              repeat_kind, repeat_weekdays, source)
  on public.chores to authenticated;
