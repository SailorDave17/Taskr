-- The extraction endpoint's call ledger — story #208.
--
-- `supabase/functions/extract-description` holds a metered provider credential
-- and answers any signed-in household member who asks. #208 AC 7 puts a bound
-- on that: one household's calls inside a named window are refused past a
-- named constant, "because an unbounded endpoint holding a metered credential
-- is a bill rather than a feature". This table is where the count lives.
--
-- ===========================================================================
-- WHY A TABLE, AND NOT A COUNTER IN THE FUNCTION'S MEMORY
-- ===========================================================================
--
-- An Edge Function runs in isolates the platform starts and discards on its
-- own schedule. A `Map` in module scope is one count PER ISOLATE, reset on
-- every cold start — and #205 measured cold starts happening between one tap
-- and the next. A bound held that way is green in every test this repo can
-- write and holds nothing a bill would notice. Owner decision at pickup,
-- 2026-09-07: the count is durable, so the bound is one bound.
--
-- The handler WRITES the row first and then counts the window with it, and
-- refuses when the count exceeds the bound — insert-then-count rather than
-- count-then-insert, because the two are separate statements with nothing
-- serialising them, and N devices counting inside one round trip would all
-- read 59 and all pass (review-fanout, 2026-09-07). Written first, the N-th
-- concurrent caller counts 59 + N and is refused: the bound fails closed. A
-- refused call therefore also spends a row, and so does an attempt the
-- provider times out on or refuses, since the row exists before the provider
-- is asked — a ledger of successes would let a failing provider be hammered
-- for free.
--
-- ===========================================================================
-- WHO CAN REACH IT — nobody but the function
-- ===========================================================================
--
-- `0011`'s device for `calendar_tokens`, for `0011`'s reason: a table no client
-- can NAME, rather than a column list a client may read part of. There is
-- nothing here a screen shows. Row-level security is on with NO policy, so a
-- grant added by accident later still reaches no row — two independent
-- mistakes would be needed rather than one. The client holds no privilege of
-- any kind; `service_role` holds SELECT and INSERT and nothing more, because
-- the function reads the window and appends to it and does neither of the
-- other two things.
--
-- The composite foreign key is `0010`'s: the member and the household a row
-- claims must be the same household, so a row pairing one family's person
-- with another family's id cannot exist. The cascade means a removed member
-- takes their rows with them, which loosens the household's bound by however
-- many calls they made this hour and nothing else.
--
-- What `check:live` sees of this file: NOTHING, and correctly. It probes what
-- the client asks for, the client asks for none of this, and #209's deploy of
-- the function is the action whose row that check carries. `npm run
-- probe:live-grants` is the instrument for this table — its control list gains
-- a row asserting `authenticated` holds no table-level privilege here — and
-- src/test/extraction-calls.pglite.test.js is the local half.
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- `create table if not exists` with the constraints declared INLINE (on a
-- re-run the whole statement is skipped and inline constraints go with it),
-- `create index if not exists`, and revokes and grants, which are idempotent
-- by nature. Applied with `npm run migrate:live`.

create table if not exists public.extraction_calls (
  id           uuid primary key default extensions.gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  member_id    uuid not null,

  -- Which flow spent the call. Not read by the bound, which is per household
  -- whatever was asked; kept so a later cost reading can say which capture
  -- surface is the one spending.
  kind         text not null,
  constraint extraction_calls_kind_known check (kind in ('capacity', 'chores')),

  called_at    timestamptz not null default now(),

  constraint extraction_calls_member_in_household
    foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade
);

comment on table public.extraction_calls is
  'One row per call the extract-description Edge Function made on a household''s '
  'behalf, written as service_role before the provider is asked. The function '
  'counts rows in the rate window and refuses past the bound. No client grant '
  'and no policy for `authenticated`. Story #208.';

-- The window count is `where household_id = $1 and called_at >= $2`, and this
-- is the index it walks. Descending so the newest rows — the only ones the
-- window ever touches — are at the front.
create index if not exists extraction_calls_household_window_idx
  on public.extraction_calls (household_id, called_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security — on, with NO policy. See the header.
-- ---------------------------------------------------------------------------

alter table public.extraction_calls enable row level security;

-- ---------------------------------------------------------------------------
-- Privileges. The revokes name `anon`, `authenticated` and `public` for 0011's
-- reason: no policy above targets any of them, so none can reach a row today —
-- but a privilege that has to STAY correct is worse than one that is absent,
-- and `public` is every role that will ever exist. `service_role` is granted
-- EXPLICITLY because it bypasses row-level security and does NOT bypass grants:
-- a fresh table on the hosted platform gives it no DML at all (0011's header,
-- measured under #334), so without this line the function would be refused
-- 42501 on the ledger it exists to keep.
-- ---------------------------------------------------------------------------

revoke all on public.extraction_calls from authenticated, anon, public;

grant select, insert on public.extraction_calls to service_role;
