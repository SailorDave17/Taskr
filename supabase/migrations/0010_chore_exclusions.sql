-- Who cannot do a chore — story #37.
--
-- The last of the four internal stories, and last on purpose. An eligibility
-- rule has close to zero user value before an allocator exists, because the only
-- entity that can hand the mower to the six-year-old today is a human who meant
-- to. Its value is derived entirely from #40/#49, which take eligibility as an
-- input predicate and never define it — so it must land before those ship, and
-- no earlier.
--
-- ===========================================================================
-- POLARITY: exclusions, not capabilities. This was a citation error, not a
-- design question
-- ===========================================================================
--
-- `docs/refresh-charter.md`'s must-survive item 2 cited a legacy field called
-- `usersWhoCanDoThisTask` — a positive capability set. MEASURED at
-- `legacy-final`: no such identifier exists anywhere in the tree. The field is
-- `usersWhoCannotDoThisTask` (TaskTemplate.java:22), an EXCLUSION set, and
-- `ResourceManager.allocateSingleTask` filters on it hard:
--
--     if (!taskTemplate.getUsersWhoCannotDoThisTask().contains(user))
--
-- The charter line was corrected in band by this story rather than left to be
-- re-litigated. Independently of the citation, a positive capability set is the
-- wrong shape here: a fresh household would allocate NOTHING until somebody
-- configured everything, which is precisely the setup burden the field scan
-- measures at 70% abandonment within 100 days and which "being set up is not a
-- project" rules out. Zero rows means everyone is eligible for everything, and
-- that is the state a household starts in and stays in until a case actually
-- bites.
--
-- ===========================================================================
-- Why the predicate is SQL and not JavaScript
-- ===========================================================================
--
-- The owner's 2026-08-06 decision makes allocation a transactional RPC with
-- automatic re-derive. A `isEligible()` in the client is structurally unreadable
-- to a server-side re-derive, so building one would make the allocator's HARD
-- constraint advisory — the same class of mistake 0006 records for
-- `assigned_member_id`, where a client-writable column would have made every
-- allocator invariant a suggestion.
--
-- So the authority is `is_member_eligible` and `eligible_members` below, usable
-- inside a single statement joining chores to members. `src/lib/exclusions.js`
-- carries a JavaScript mirror for the SCREEN — which person to warn about — and
-- says in its own header that it is not the authority and not a boundary.
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- Applied by a human pasting into the Supabase SQL editor, so a re-paste after a
-- partial failure is the normal path rather than an edge case. The table uses
-- `if not exists` with its constraints declared INLINE (0003's device: on a
-- re-run the whole `create table` is skipped and the constraints go with it),
-- the unique key on `chores` goes through the `pg_constraint` lookup 0005 uses
-- because `alter table add constraint` has no idempotent form, policies are
-- preceded by `drop policy if exists`, and the functions are `create or replace`.

-- ---------------------------------------------------------------------------
-- 1. `chores` needs a composite key before anything can reference it that way
-- ---------------------------------------------------------------------------

-- Exactly 0005's argument for `members_id_household_key`, one table over. An
-- exclusion row names a chore, a member and a household, and the row's RLS
-- policies key on `household_id` — so without composite references the row could
-- name a chore of one household and a household_id of another, and be visible to
-- the wrong family while pointing at a chore they cannot see.
--
-- `members (id, household_id)` already has its key from 0005, which is why only
-- the chores half is added here.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chores_id_household_key'
  ) then
    alter table public.chores
      add constraint chores_id_household_key unique (id, household_id);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. The exclusion itself
-- ---------------------------------------------------------------------------

-- One row per (chore, person) pair that must not be put together. The ABSENCE of
-- a row is the whole default: a household with no rows here has every member
-- eligible for every chore, and a member added tomorrow is eligible for
-- everything that already exists without anything being written. #37 AC 1 asserts
-- that as a row COUNT before and after, not merely as a predicate result,
-- because the failure worth guarding is a later story quietly backfilling rows
-- "for completeness" and turning the default inside out.
create table if not exists public.chore_exclusions (
  id           uuid primary key default extensions.gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  chore_id     uuid not null,
  member_id    uuid not null,
  created_at   timestamptz not null default now(),

  -- "This person cannot do this chore" is a fact, not a quantity: saying it
  -- twice is the same fact, so the second write is refused rather than stored.
  -- AC 2 asks for EXACTLY ONE row, and this is what makes that structural
  -- instead of a property of whichever screen happened to write it.
  constraint chore_exclusions_one_per_pair unique (chore_id, member_id),

  -- Both references are COMPOSITE, and between them they are the cross-household
  -- rule: the chore and the member must belong to the household this row claims,
  -- so a row pairing one family's chore with another family's person cannot
  -- exist at all. 0006 makes the same argument for `assigned_member_id` and
  -- states the reason this matters more than it looks — a rule living only
  -- inside a function is a rule for clients that choose to call it.
  --
  -- `on delete cascade` on both is AC 10, and it is why the cascade is on the
  -- exclusion rather than anywhere else: a rebuilt chore must not silently
  -- inherit an exclusion naming a person who no longer exists, and neither half
  -- of the pair is meaningful without the other. Contrast 0006, where deleting a
  -- member RELEASES their chores rather than destroying them — a chore survives
  -- the person, an exclusion does not, because the exclusion IS the pairing.
  constraint chore_exclusions_chore_in_household
    foreign key (chore_id, household_id)
    references public.chores (id, household_id) on delete cascade,

  constraint chore_exclusions_member_in_household
    foreign key (member_id, household_id)
    references public.members (id, household_id) on delete cascade
);

comment on table public.chore_exclusions is
  'One row per (chore, member) pair that must not be put together. Absence is '
  'the default: no row means eligible, so a fresh household allocates without '
  'anyone configuring anything. Story #37.';

-- `chore_exclusions_one_per_pair` already indexes (chore_id, member_id), which
-- serves both `is_member_eligible` and `eligible_members`. This one is for the
-- other direction: the cascade fired by deleting a MEMBER, and any later query
-- asking what one person is excluded from.
create index if not exists chore_exclusions_member_idx
  on public.chore_exclusions (member_id);

-- ---------------------------------------------------------------------------
-- 3. Row-level security — which ROWS
--
-- Same trust boundary as every other table here: a household, and inside it
-- everyone maintains the work. Recording that a person cannot do a chore is NOT
-- restricted to the organizer, and that is a decision rather than an oversight —
-- `docs/access-model.md` ratifies the flat boundary, restricting this would
-- reintroduce the admin console that model explicitly rejects, and a child
-- excluding themselves from everything is a social problem rather than a data
-- one. It is a one-line change to `is_household_organizer()` if the household
-- ever wants it.
--
-- There is deliberately NO UPDATE policy and no update grant. An exclusion has
-- no editable content — it is a pair, and changing either half is a different
-- pair. Undoing one is a DELETE.
-- ---------------------------------------------------------------------------

alter table public.chore_exclusions enable row level security;

drop policy if exists chore_exclusions_select_same_household on public.chore_exclusions;
create policy chore_exclusions_select_same_household
  on public.chore_exclusions for select to authenticated
  using (household_id in (select public.current_household_ids()));

drop policy if exists chore_exclusions_insert_same_household on public.chore_exclusions;
create policy chore_exclusions_insert_same_household
  on public.chore_exclusions for insert to authenticated
  with check (household_id in (select public.current_household_ids()));

drop policy if exists chore_exclusions_delete_same_household on public.chore_exclusions;
create policy chore_exclusions_delete_same_household
  on public.chore_exclusions for delete to authenticated
  using (household_id in (select public.current_household_ids()));

-- ---------------------------------------------------------------------------
-- 4. Column-level privileges — which COLUMNS
--
-- Revoked from `anon` alongside `authenticated` for 0002's reason, restated by
-- 0003 and 0005: no policy above targets anon so it cannot reach a row today,
-- but that is one `to anon` away from being false, and a privilege that has to
-- STAY correct is worse than one that is simply absent.
-- ---------------------------------------------------------------------------

revoke all on public.chore_exclusions from authenticated, anon;

-- `household_id` is absent, matching 0003 on chores and 0005 on member_capacity:
-- it is written on insert and never read back, because row-level security
-- already guarantees every row this device can see belongs to its household. The
-- side effect is the one that matters — withholding a column is what makes
-- `select('*')` FAIL OUTRIGHT on this table rather than quietly return whatever
-- exists, so a forgotten column list is a loud error instead of a silent one.
grant select (id, chore_id, member_id, created_at)
  on public.chore_exclusions to authenticated;

-- `id` and `created_at` are absent: both are the database's to say.
grant insert (household_id, chore_id, member_id)
  on public.chore_exclusions to authenticated;

grant delete on public.chore_exclusions to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The predicate, in SQL, because the allocator has to be able to use it
-- ---------------------------------------------------------------------------

-- `language sql` rather than plpgsql so the planner can INLINE it into a
-- surrounding query: AC 4's shape is a single statement joining chores to
-- members, and a plpgsql call per pair would be a per-row function invocation in
-- the allocator's hottest loop.
--
-- `security definer` so the answer does not depend on WHO ASKS. An invoker
-- predicate reading this table under row-level security would return "eligible"
-- for a chore whose exclusions the caller cannot see — a wrong answer that looks
-- exactly like a right one, which is the worst available failure for a predicate
-- whose whole job is to be the authority.
--
-- Execute is deliberately NOT granted to `authenticated`, and the two decisions
-- go together: a definer predicate that clients could call would answer about
-- chores in OTHER households, one bit at a time. The consumers are server-side —
-- a future allocator RPC, itself definer, which runs as the owner and so needs
-- no grant. The client does not need this function: it reads the exclusion rows
-- for its own household and derives what to draw from them.
--
-- THE ARGUMENT NAMES SHADOW THE COLUMN NAMES, and that is not cosmetic. In a SQL
-- function a bare `chore_id` inside a query over `chore_exclusions` resolves to
-- the COLUMN, not the parameter — so `where x.chore_id = chore_id` is a column
-- compared with itself, always true, and the function would report every member
-- of every household ineligible for everything. Qualifying with the function's
-- own name is the documented way to mean the parameter. The names are the ones
-- #37 AC 4 states, so they are kept and disambiguated rather than renamed, and
-- `exclusions.pglite.test.js` asserts that excluding ONE person leaves the
-- others eligible — which is the assertion the self-comparison bug fails.
create or replace function public.is_member_eligible(chore_id uuid, member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.chore_exclusions x
    where x.chore_id = is_member_eligible.chore_id
      and x.member_id = is_member_eligible.member_id
  );
$$;

comment on function public.is_member_eligible(uuid, uuid) is
  'May this member do this chore? True unless an exclusion row pairs them. '
  'Security definer so the answer is the same whoever asks; not granted to '
  'clients, because it would then answer about other households. Story #37.';

-- Every member of the chore's household who is not excluded from it.
--
-- Returns the EMPTY SET when everyone is excluded — AC 5 — rather than raising
-- and rather than falling back to everyone. Both of those alternatives are worse
-- in the same direction: they hide an impossible allocation from the one caller
-- that could report it. #40's "level is unreachable" surface is where an empty
-- set becomes a sentence a household reads, in the same message shape as the
-- granularity-floor case, so the product ships ONE honest message about
-- impossible allocation rather than two competing ones.
--
-- A chore id naming nothing also returns the empty set, because the join finds
-- no household to draw members from. That is the right answer for an allocator —
-- there is nobody who may do a chore that does not exist — and it is asserted
-- rather than left to be discovered, since "empty" and "empty for a different
-- reason" are indistinguishable at the call site.
create or replace function public.eligible_members(chore_id uuid)
returns setof public.members
language sql
stable
security definer
set search_path = ''
as $$
  select m.*
  from public.chores c
  join public.members m on m.household_id = c.household_id
  where c.id = eligible_members.chore_id
    and not exists (
      select 1
      from public.chore_exclusions x
      where x.chore_id = c.id and x.member_id = m.id
    );
$$;

comment on function public.eligible_members(uuid) is
  'Members of the chore''s household who are not excluded from it. Empty set '
  'when everyone is excluded, rather than raising or falling back to everyone. '
  'Story #37.';

-- Not granted, for the reason `is_member_eligible` states at length. `revoke
-- from public` is what actually removes the default execute privilege every new
-- function carries; anon and authenticated are named as well so the intent is
-- readable rather than inferred from a default.
revoke all on function public.is_member_eligible(uuid, uuid) from public, anon, authenticated;
revoke all on function public.eligible_members(uuid)         from public, anon, authenticated;
