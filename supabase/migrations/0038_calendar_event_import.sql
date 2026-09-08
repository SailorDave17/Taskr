-- Importing a calendar event as a one-time chore — story #101.
--
-- `0011` connected a calendar, `0030` derived a busy figure from it and `0031`
-- let a member confirm that figure as capacity. This is the charter's SECOND
-- half of the calendar decision (2026-08-16): a commitment already on somebody's
-- calendar becomes a chore without being typed twice. Two things change here,
-- and the whole file is the argument for why only two.
--
-- ===========================================================================
-- 1. `chores.source` learns a third word
-- ===========================================================================
--
-- #101 was filed saying the chores table had no provenance column and that an
-- import must keep clear of whatever #68 eventually added. #68 closed; `0023`
-- (#211) added `source` with `manual | extraction`, and its comment named an
-- import as exactly the third path to widen the constraint for. So an imported
-- chore is written THROUGH the same `addChore` path a typed one is (#101 AC 3),
-- with `source = 'calendar'` — the same word `0031` gave `member_capacity` for
-- a figure a member took from their calendar, so the two provenance columns
-- keep reading as one idea. No new column on `chores`, which is AC 4's letter
-- and its point: the accuracy question can tell an imported chore from a typed
-- one, and nothing else about the row is different.
--
-- Owner decision at pickup, 2026-09-08, over leaving imports as `manual` and
-- letting the ledger below be the only record: that would make an imported
-- chore indistinguishable from a typed one everywhere but a join nobody asking
-- the accuracy question would think to make.
--
-- ===========================================================================
-- 2. The import ledger — the one calendar datum this schema keeps
-- ===========================================================================
--
-- `calendar_imports` holds, per import: the household, who imported it, the
-- Google event id and the chore it became. THE EVENT ID IS THE ONLY THING HERE
-- THAT CAME OUT OF ANYBODY'S CALENDAR, and it is kept for exactly one reason —
-- so a second import of the same event is refused as already imported (AC 5).
-- There is no column here that could hold a title, a time, an attendee or a
-- location: titles transit the `calendar-events` Edge Function per request and
-- reach the phone, never a table. `0030`'s rule, restated: a rule written as an
-- absent column cannot be broken without a migration somebody has to review.
--
-- WHAT MAKES A DUPLICATE (owner decision at pickup, 2026-09-08): one import
-- per HOUSEHOLD per event id, not per member. A shared event carries the same
-- Google id on every invitee's calendar, and a chore is a household fact — so
-- the second housemate to try is shown "already imported" rather than handed a
-- second chore, which is the duplicate this story exists to prevent. Rejected:
-- per member, which allows exactly that duplicate across members.
--
-- WHO IS ATTRIBUTED, AND WHAT A REMOVED MEMBER LEAVES. `member_id` is the
-- importer, and it is NULLABLE with `on delete set null (member_id)` — the
-- column-list form `0006`, `0012`, `0018` and `0032` all use, because a
-- composite FK's bare `set null` nulls the scoping column too (measured under
-- #352, recorded in cairn twice). A removed member leaves the WHEN and the
-- WHAT and loses the WHO, which is the charter's 2026-08-26 leave/close
-- decision applied: the chore they imported stays on the household's list, so
-- the row saying it was imported stays with it, and the event cannot be
-- imported a second time because its importer left. `0036`'s ledger cascades
-- instead, and the difference is what each row is FOR — a rate-limit row is
-- about the member's calls; this row is about the household's chore.
--
-- The chore FK cascades, and that direction is deliberate too: removing the
-- chore is the household saying the import was wrong, and after it the same
-- event may be imported again. `chore_id` is UNIQUE — one chore came from at
-- most one event — and the composite FK (`chore_id, household_id`) is `0010`'s
-- device, so a row cannot pair one household's chore with another's id.
--
-- WHAT A DISCONNECT LEAVES (owner decision at pickup, 2026-09-08). #99's
-- `calendar-disconnect` deletes the token, the derived figures and the
-- connection, credential first, and does NOT delete from this table. The chore
-- survives a disconnect — it is on the list, assigned, counted — so its ledger
-- row survives with it, and a reconnect cannot import the same event twice. An
-- event id alone identifies nothing without the calendar it came from.
-- Rejected: deleting these rows with the others, which forgets more and
-- permits the duplicate across a reconnect.
--
-- WHO WRITES. The CLIENT, and that is the first calendar table where it does:
-- `calendar_tokens`, `calendar_connections` and `calendar_busy` are all
-- `service_role`-only because each holds or derives from a credential. This
-- holds an id the member has already been shown on their own phone (the
-- `calendar-events` function returned it to them), beside a chore they just
-- created through a grant they already hold. So `authenticated` may INSERT,
-- under a policy that pins the row to the caller's OWN member row in a
-- household they belong to — a member cannot record an import as a housemate
-- — and may SELECT the household's rows, so every phone can draw "already
-- imported" beside the event. No UPDATE and no DELETE grant: a ledger row has
-- no editable content, and the only way it leaves is the chore going.
-- This file GRANTS `service_role` nothing, because no Edge Function touches the
-- table — the `calendar-events` function LISTS events and writes nothing, which
-- its test asserts by recording every write the fake client sees. What the role
-- HOLDS is another matter, and it is a fact about the project rather than about
-- this file: *measured 2026-09-08 after the apply*, the hosted project's
-- inherited default privileges hand `service_role` `arwdDxtm` on every table in
-- `public` — this one, `chore_exclusions`, `households`, all of them — while the
-- pglite harness's default hands it `Dxtm` and no DML (the shape cairn records
-- as *the harness cannot catch what the platform granted*). Nothing runs as
-- that role against this table, so the grant is unused rather than dangerous;
-- it is written down so the next reader of `probe:live-grants` does not read
-- `service_role=arwdDxtm` here as a statement this file made.
--
-- THE TWO WRITES ARE TWO STATEMENTS, and this file cannot make them one. The
-- client creates the chore through `addChore` (AC 3 forbids a second write
-- path, and an RPC inserting into `chores` would be one) and then records the
-- import; the unique constraint below is what serialises two phones importing
-- the same event in the same second — the second insert is refused `23505`,
-- and the client removes the chore it just created and shows the refusal.
-- Between the two statements a chore can exist with no ledger row; that window
-- is one round trip wide, and its cost is a duplicate that the second phone's
-- refusal reports rather than hides. Recorded here because a later reader will
-- reasonably ask why this is not a transaction, and the answer is AC 3.
--
-- `household_id` IS in the select grant — the `0014` route the three shopping
-- tables take, not the withheld-column route `calendar_busy` takes — because
-- the client reads this table BY HOUSEHOLD: "already imported" is a fact about
-- the household's list, and a row whose importer has since been removed
-- (`member_id` null) must still be read, which a member-scoped read would drop.
-- `select('*')` therefore succeeds here, as it does on the shopping tables; the
-- per-column grant shape (no table-level SELECT) is what survives.
--
-- ===========================================================================
-- 3. The Realtime publication
-- ===========================================================================
--
-- `0037` put every table the client reads into `supabase_realtime`, derived
-- from `LIVE_SCHEMA` minus the self-scoped seen-marker, and
-- `src/test/realtime.pglite.test.js` holds the publication equal to that
-- derivation in both directions. This table joins `LIVE_SCHEMA`, so it joins
-- the publication here, with `0037`'s idempotent shape: a second phone that
-- imports an event moves this phone's "already imported" mark without a reload.
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- The constraint is DROPPED and re-added for `0031`'s reason: it already exists
-- with a narrower definition, so an `if not exists` guard would read the old
-- one as present and leave the widening unapplied — the failure that looks like
-- success. `create table if not exists` with the constraints INLINE, `create
-- index if not exists`, `drop policy if exists` before each policy, grants and
-- revokes (idempotent by nature), and the publication add guarded by a catalog
-- lookup exactly as `0037` guards its eleven. Applied with `npm run migrate:live`.
--
-- What `check:live` sees of this file: the `calendar_imports` table row (the
-- client reads it) and its publication row, red on purpose until the apply. It
-- cannot see the constraint widening — `0031`'s blindness, for `0031`'s reason
-- — so the instrument for section 1 is the read-only catalog query
-- (`pg_get_constraintdef` on `chores_source_known`) taken on both sides.

-- ---------------------------------------------------------------------------
-- 1. `chores.source` admits 'calendar'
-- ---------------------------------------------------------------------------

alter table public.chores
  drop constraint if exists chores_source_known;

alter table public.chores
  add constraint chores_source_known
  check (source in ('manual', 'extraction', 'calendar'));

comment on column public.chores.source is
  'How the chore came to exist: manual (a person typed it), extraction (a '
  'proposal accepted from plain-language capture, #211) or calendar (an event '
  'imported from a connected Google Calendar, #101). Provenance, never '
  'privilege - it grants nothing and no rule keys off it. Distinct from '
  'assigned_source, which records how the ASSIGNMENT was decided and shares no '
  'vocabulary with this column. Mirrors member_capacity.source (0005, 0031).';

-- ---------------------------------------------------------------------------
-- 2. The ledger
-- ---------------------------------------------------------------------------

create table if not exists public.calendar_imports (
  id                uuid primary key default extensions.gen_random_uuid(),
  household_id      uuid not null references public.households (id) on delete cascade,

  -- Who imported it. Nullable, and null MEANS "the importer has since left the
  -- household" — see the header. Never null at insert: the policy below
  -- requires it to be the caller's own member row.
  member_id         uuid,

  -- Google's event id, as returned by the Calendar API. The one calendar datum
  -- this table holds, kept only so a second import can be refused. Bounded
  -- because Google's ids are short (a few dozen characters) and an unbounded
  -- text column is a place to put something that is not an id.
  calendar_event_id text not null,

  chore_id          uuid not null,

  imported_at       timestamptz not null default now(),

  -- One import per household per event — the idempotency AC 5 asks for, and the
  -- constraint two phones importing the same event in the same second are
  -- serialised by.
  constraint calendar_imports_one_per_event unique (household_id, calendar_event_id),

  -- One chore came from at most one event.
  constraint calendar_imports_one_per_chore unique (chore_id),

  constraint calendar_imports_event_id_shape
    check (calendar_event_id <> '' and length(calendar_event_id) <= 1024),

  -- COMPOSITE, for 0010's reason: the member and the household this row claims
  -- must be the same household. `set null (member_id)` with the COLUMN LIST —
  -- the bare form nulls `household_id` as well and the delete of the member is
  -- refused (`0032`'s measured correction).
  constraint calendar_imports_member_in_household
    foreign key (member_id, household_id)
    references public.members (id, household_id) on delete set null (member_id),

  -- And the chore must be this household's too. Cascade: a removed chore takes
  -- its import record with it, so the event may be imported again.
  constraint calendar_imports_chore_in_household
    foreign key (chore_id, household_id)
    references public.chores (id, household_id) on delete cascade
);

comment on table public.calendar_imports is
  'One row per calendar event imported as a chore: household, importer, the '
  'Google event id and the chore it became. The event id is the ONLY calendar '
  'datum this schema retains, kept so a second import of the same event is '
  'refused (unique per household). Holds no title, time, attendee or location. '
  'Written by the client after addChore, never by an Edge Function; survives a '
  'calendar disconnect because the chore does. Story #101.';

-- The cascade fired by deleting a member, and any later "what did this person
-- import". `calendar_imports_one_per_event` already indexes the household, and
-- `calendar_imports_one_per_chore` the chore.
create index if not exists calendar_imports_member_idx
  on public.calendar_imports (member_id);

-- ---------------------------------------------------------------------------
-- Row-level security — which ROWS
-- ---------------------------------------------------------------------------

alter table public.calendar_imports enable row level security;

-- The household is the trust boundary, as on every table here. That an event
-- was imported is the same class of fact as the chore it became, which the
-- whole household can already read.
drop policy if exists calendar_imports_select_same_household on public.calendar_imports;
create policy calendar_imports_select_same_household
  on public.calendar_imports for select to authenticated
  using (household_id in (select public.current_household_ids()));

-- INSERT is pinned to the caller's OWN member row in a household they belong
-- to. The subquery runs under `members`' own policies as the caller, who can
-- see their own row; a housemate's id fails the match and the insert is
-- refused, so nobody can record an import as somebody else. There is no
-- UPDATE and no DELETE policy, and no grant to match — see the header.
drop policy if exists calendar_imports_insert_own_row on public.calendar_imports;
create policy calendar_imports_insert_own_row
  on public.calendar_imports for insert to authenticated
  with check (
    household_id in (select public.current_household_ids())
    and member_id is not null
    and member_id in (
      select m.id from public.members m
      where m.household_id = calendar_imports.household_id
        and m.claimed_by = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Privileges — which COLUMNS, and for whom
--
-- The revokes come first and name `anon` alongside `authenticated`, 0002's
-- convention restated by every table since: no policy above targets `anon`, so
-- it cannot reach a row today, but that is one `to anon` away from being false.
-- No `service_role` grant at all: nothing runs as it against this table, and a
-- grant nothing uses is a privilege with nothing behind it.
-- ---------------------------------------------------------------------------

revoke all on public.calendar_imports from authenticated, anon;

-- Every column, by name — the `0014` route (see the header for why the read is
-- by household). `CALENDAR_IMPORT_COLUMNS` in src/lib/calendar.js is the same
-- list, and calendarImport.pglite.test.js holds the two equal.
grant select (id, household_id, member_id, calendar_event_id, chore_id, imported_at)
  on public.calendar_imports to authenticated;

-- `id` and `imported_at` are absent: both are the database's to say.
grant insert (household_id, member_id, calendar_event_id, chore_id)
  on public.calendar_imports to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Realtime — `0037`'s shape, for one table
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'calendar_imports'
  ) then
    alter publication supabase_realtime add table public.calendar_imports;
  end if;
end
$$;
