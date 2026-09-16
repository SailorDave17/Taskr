-- The invitation record and its access rules — story #171.
--
-- The first half of admission. `0007` made membership a claimed member row and
-- `current_household_ids()` the predicate every policy reads through; since
-- then the only way into a household has been an organizer minting an account
-- through `provision-member`. #191 retires that path and #172/#173 replace it:
-- an organizer mints a code, somebody holding it redeems it and a member row is
-- created for them. This file is the record those two stories read and write,
-- and the one function that can create that row.
--
-- It ships nothing a person can see, which is the honest cost of landing schema
-- and its access rules together (#171's own "Why this shape"). What it must get
-- right is the part a screen cannot repair afterwards.
--
-- ===========================================================================
-- 1. THE SECRET IS STORED AS A HASH, AND NEVER AS A CODE — AC 4
-- ===========================================================================
--
-- AC 4 offers two routes and asks this file to argue for the one it took.
-- Owner decision at pickup, 2026-09-10, taken at a clickable question: the row
-- holds `token_hash` and the plaintext code exists nowhere in the database.
--
-- WHY, and it is a decision this record has already taken once. `docs/data-
-- outside-production.md`'s **Decision 3, control 6** — Taskr's own, with no
-- cohssa analogue — says a credential belonging to somebody else is held in a
-- table with no client grant and no policy, and its *revisit when* fires on
-- "a credential of that class stored any other way". An invitation code is that
-- class: a bearer secret that admits its holder to household data. Storing the
-- spendable string and withholding it by column grant would have been the other
-- route, and it makes the column grant the only thing between a client and every
-- outstanding code — one accidental `grant select (token)` in a later migration
-- exposes all of them at once, which is exactly the two-independent-mistakes
-- property `0011` and `0036` were written to have. A hash has no such line to
-- get wrong: there is nothing in the row to withhold.
--
-- WHAT IT COSTS, stated because it is a real loss and #172 inherits it. The code
-- can be displayed exactly ONCE, at the moment it is minted, because after that
-- nothing in the system can recover it. #172's "outstanding invitations" list
-- shows when each was created and when it expires and CANNOT show the code, and
-- an organizer who loses one withdraws it and mints another. That is a screen
-- consequence decided here, so #172 does not get to rediscover it.
--
-- `extensions.digest(code, 'sha256')` — pgcrypto, installed by `0002` with
-- schema `extensions`, and available in the pglite harness because
-- `support/pgliteSupabase.js` loads the same extension. NOT bcrypt, which
-- `0002` used for a PIN: bcrypt is deliberately slow to make a four-digit human
-- secret expensive to attack offline, and this secret is not human-chosen — it
-- is 160 bits minted by `gen_random_bytes`, so there is no dictionary to walk
-- and a slow hash would only make redemption slow. The comparison is on a
-- `bytea` equality against a unique index, which is what makes redemption a
-- single index lookup rather than a scan over every outstanding row.
--
-- ===========================================================================
-- 2. WHAT A ROW MAY HOLD — Decision 4, clause 3
-- ===========================================================================
--
-- `docs/data-outside-production.md`'s **Decision 4** was written on 2026-09-04
-- for this story, "to be consumed as clauses, not paraphrased", and clause 3 is
-- the one with a schema consequence: neither an emailed invitation nor a typed
-- code may carry household CONTENTS before redemption completes — no roster, no
-- other member's name or address, no chores, no completion history, no capacity
-- figures, and not the household id.
--
-- So this table holds the household id (it must — the row's whole purpose is to
-- name which household is being joined) and NOTHING is granted to a client that
-- would let a non-member read it. A person redeeming a code learns which
-- household they joined by joining it; they cannot ask beforehand. That is
-- clause 3 enforced by the absence of a read path rather than by a screen
-- remembering not to draw one, which is the same argument `0011` makes about
-- the refresh token.
--
-- There is deliberately no `display_name`, no `email` and no invitee column of
-- any kind. #191's owner decision is that **the recipient names themselves** at
-- redemption, so a column here for the organizer's typed name would be a place
-- for a name the roster must not take. #177's email path personalises the
-- message it sends and stores nothing.
--
-- ===========================================================================
-- 3. WHO MAY DO WHAT — AC 2
-- ===========================================================================
--
-- Reading and writing invitations is the ORGANIZER's, through
-- `is_household_organizer(uuid)` — `0002`'s definer predicate, which `0016`
-- already uses for the other organizer-only act (removing a member) and which
-- fails closed on a household whose `organizer_member_id` is null. Three
-- properties, each proven in `invitations.pglite.test.js` over a client-role
-- connection in both directions:
--
--   * the organizer of the household reads and writes its invitations;
--   * a member of that household who is NOT the organizer reads nothing —
--     `current_household_ids()` would have admitted them, and the organizer
--     clause is what does the work, which is why the test asserts a non-
--     organizer member and not merely a stranger;
--   * a non-member reads nothing at all.
--
-- The household clause is kept ALONGSIDE the organizer clause rather than
-- replaced by it. `is_household_organizer` alone IS sufficient — it joins
-- through `households` — and the pair is `0016`'s shape: two predicates that
-- must both hold, so a future change to either leaves the other standing.
--
-- *Measured, and the measurement is worth more than the claim.* Dropping the
-- household clause and keeping the organizer one reddens **0 of 46** — so the
-- household clause is genuinely redundant today, and the redundancy is
-- deliberate rather than accidental. Dropping the ORGANIZER clause and keeping
-- the household one reddens **2**: the non-organizer member starts reading, and
-- the no-organizer household stops failing closed. So the organizer clause is
-- what carries the rule and the household clause is defence in depth.
--
-- Read the zero carefully rather than as reassurance (cairn:
-- `a-predicted-zero-is-still-a-zero`): it says no test distinguishes the pair
-- from the organizer clause alone, which is a fact about the suite as well as
-- about the schema. It is kept because `is_household_organizer` is `security
-- definer` and reads `households` — if a later migration ever changed what that
-- function joins through, the household clause is the predicate still standing.
--
-- ===========================================================================
-- 4. REDEMPTION IS A DEFINER FUNCTION, AND IT HAS TO BE — AC 5
-- ===========================================================================
--
-- `members_insert_same_household` (`0001`, re-pointed by `0007`) requires
-- `household_id in (select public.current_household_ids())`. A person redeeming
-- an invitation is BY DEFINITION not yet in the household, so that predicate is
-- false for them and no client insert can ever succeed. This is not a policy to
-- widen: widening it would let any signed-in stranger add themselves to any
-- household, which is the whole property the schema protects.
--
-- So `redeem_invitation(code text)` is `security definer` with `search_path`
-- pinned to the empty string, and `execute` is revoked from `public` AND from
-- `anon` explicitly — `0034`'s idiom, and the second word is load-bearing on
-- this project rather than decorative: with `from public` alone the live catalog
-- read `anon` still holding execute on a new function, reported as a stray by
-- `npm run probe:live-grants` on `0034`'s first apply, and no test in this repo
-- could have caught it because `revoke ... from public` removes the PUBLIC
-- default that is all `anon` has under pglite. Copy the idiom; do not re-derive
-- it (cairn: the-harness-cannot-catch-what-the-platform-granted).
--
-- WHAT THE FUNCTION REFUSES, AND WHAT ITS REFUSALS MAY SAY — Decision 4 clause 4
--
-- "Every refusal discloses nothing at all ... The four cases may each say *why*
-- they were refused; none may say *what* was refused." So every refusal here
-- names its own reason and NONE names the household, its name, or the fact that
-- a household matching the code exists:
--
--   'not authenticated'                 no session
--   'that invitation cannot be used'    no such code, expired, withdrawn, or
--                                       already redeemed — ONE sentence for
--                                       four states, see below
--   'you are already in that household' the one case that necessarily discloses
--                                       something, and only to somebody who is
--                                       already inside
--
-- The four unusable states share one sentence deliberately, and this is the
-- clause-4 decision worth stating: `0035` and `0034` refuse by name because
-- their caller is already inside the household and a precise sentence helps
-- them. Here the caller may be anybody at all, and four distinguishable
-- refusals are an oracle — "withdrawn" tells whoever is guessing codes that
-- they found a real one. #173 AC 3 asks that each of expired, withdrawn and
-- already-redeemed be "refused with its own message"; those messages are the
-- SURFACE's, drawn from what the person did, and they cannot come from here
-- without handing the same information to somebody who is guessing. #173 owns
-- that screen and this comment is where the constraint is recorded.
--
-- The already-a-member case is checked BEFORE the invitation is spent, which is
-- #173 AC 2's letter: "it is refused with a message naming that, and the
-- invitation is NOT spent."
--
-- ===========================================================================
-- 5. REDEEMED ONCE — AC 6
-- ===========================================================================
--
-- `redeemed_at` is stamped from the database clock and the function refuses a
-- row that already carries one. The check and the stamp are under a `for update`
-- lock on the invitation row, taken by its PRIMARY KEY rather than through a
-- mutable predicate — `0035`'s correction, and cairn's
-- `a-lock-through-a-mutable-predicate-loses-its-row`: a lock taken through
-- `redeemed_at is null` would not survive a concurrent redemption retiring the
-- row it matched, the qual would be re-checked, `found` would be false and the
-- guarded branch skipped WHOLE. The row is identified by hash first, then locked
-- by its own id, so two phones redeeming one code in the same instant are
-- serialised and the second reads the stamp the first wrote.
--
-- ===========================================================================
-- 6. HOLDING AN ACCOUNT IS NOT ENOUGH — AC 7
-- ===========================================================================
--
-- `disable_signup: false` on this project means anybody can mint an account
-- with the anon key. That is deliberate and is what lets an invited person sign
-- themselves up. It is also why this function exists rather than a policy: an
-- account grants NOTHING here. A signed-in caller with no invitation reaches
-- `'that invitation cannot be used'` and creates no row, which
-- `invitations.pglite.test.js` proves with an auth user that holds no member row
-- anywhere.
--
-- ===========================================================================
-- 7. GRANTS — AC 3
-- ===========================================================================
--
-- `0013` is this file's subject: the platform no longer infers grants, so every
-- privilege is stated. The revokes come FIRST and name `authenticated`, `anon`
-- and `public` — `0036`'s three-role form, because `public` is every role that
-- will ever exist — and the grants that follow are the complete client surface.
--
-- NO narrow `revoke select, insert, update` anywhere in this file. That form is
-- exactly `0013`'s defect: it preserves DELETE if DELETE was ever granted, which
-- on this project it was by inheritance, so the schema in git and the schema in
-- production disagreed in the direction nothing checks. `revoke all` then grant
-- by name is the only form used here.
--
-- `service_role` is granted NOTHING. No Edge Function touches this table today:
-- #172 mints through an RPC as the organizer and #173 redeems through the
-- function below as the invitee, both as `authenticated`. #177's email path may
-- want a server later; that is a decision for the file that adds it, and a grant
-- nothing uses is a privilege with nothing behind it. What the role HOLDS is a
-- different question and a fact about the project rather than about this file —
-- *measured 2026-09-08 under #101*, the hosted project's inherited default
-- privileges hand `service_role` `arwdDxtm` on every table in `public`, so
-- `npm run probe:live-grants` will read that here too and it is not a statement
-- this file made.
--
-- ===========================================================================
-- 8. WHAT EACH INSTRUMENT CAN SEE — AC 8
-- ===========================================================================
--
-- `npm run check:live` sees NEITHER HALF of this file, and that is a departure
-- from AC 8's letter taken deliberately at the owner's gate (2026-09-10).
--
-- AC 8 asks that `liveSchema.js` gain the table AND the function so the check is
-- red on purpose until the paste. Both halves are refused by that file's own
-- guards, for one reason: **#171 ships no client code at all.** `LIVE_SCHEMA` is
-- what the client READS and `LIVE_RPCS` is what it CALLS, and
-- `src/lib/liveSchema.test.js` holds each equal to what `src/` actually does, in
-- both directions. The reads arrive with #172 and the call with #173, so an
-- entry here today reddens that guard — *measured on this branch, 1 of 54*, on
-- the RPC half — and a probe for something nothing calls reports a missing grant
-- on a project that is entirely correct. That is the `household_devices` mistake
-- with the sign flipped, which `liveSchema.js` already records twice.
--
-- The repo has a shape for exactly this and asserts it as a test:
-- `calendar_tokens` (`0011`) and `extraction_calls` (`0036`) are both absent from
-- `LIVE_SCHEMA` and present in `MEASURED_TABLE_ACLS`, and
-- `scripts/probe-live-grants.test.js` asserts the pair so neither can be added in
-- one place and forgotten in the other. This table joins them, for a DIFFERENT
-- reason worth keeping distinct: those two are readable by nobody, while this one
-- is readable by the household's organizer — it is out of `LIVE_SCHEMA` because
-- the reader has not shipped, not because there will never be one.
--
-- So `npm run check:live` reads the SAME on both sides of this paste and says
-- nothing about whether it happened. Two instruments cover it instead:
--
--   * `npm run probe:live-grants` — the table's control row (`authenticated`
--     holds no TABLE-level privilege, every grant below being by column) and the
--     function's ACL, which is the half that can see `anon` holding execute;
--   * the read-only catalog query in `docs/access-model.md`'s `0040` entry, for
--     the four policies and the function body, which no other instrument reads.
--
-- #172 and #173 add the `LIVE_SCHEMA` and `LIVE_RPCS` entries in the same change
-- that adds the client code, and the red-on-purpose window AC 8 wants belongs to
-- those stories rather than to this one.
--
-- Neither can see a POLICY. `0016` records the same blindness for the same
-- reason, and the read-only catalog query in `docs/access-model.md`'s `0040`
-- entry is what reads the four policies back after the apply.
--
-- Not in the Realtime publication. `0037` fills it from `LIVE_SCHEMA`, and
-- `src/test/realtime.pglite.test.js` holds the publication equal to that
-- derivation in both directions — so a table absent from `LIVE_SCHEMA` and
-- present in the publication reddens it. When #172 gives the organizer a live
-- list, the story that adds the client read adds both.
--
-- ===========================================================================
-- 9. RETIRED VOCABULARY — AC 1
-- ===========================================================================
--
-- Nothing here spells any of the eleven names `0007` retired
-- (`src/test/support/retiredVocabulary.js`). The near miss is real and worth
-- naming: the retired admission model had a `join_code` column and a
-- `join_household(code)` function, and this file does the same JOB. The names
-- are `invitations`, `token_hash` and `redeem_invitation` — chosen so the widened
-- #170 guard passes on executable code, not by spelling a banned word in a way
-- that dodges a scanner. `supabase/migrations/` is one of the four directories
-- that guard covers.
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- `create table if not exists` with every constraint INLINE (on a re-run the
-- whole statement is skipped and its constraints go with it), `create index if
-- not exists`, `drop policy if exists` before each policy, `create or replace`
-- for the function, and revokes and grants that are idempotent by nature.
-- Re-runnable against the schema this file was written for, which is the only
-- claim any migration here makes (cairn's
-- `a-migration-is-re-runnable-only-against-its-own-schema`);
-- `invitations.pglite.test.js` applies it twice to prove it.
--
-- This file declares no function any earlier file declares, so re-pasting it
-- alone reverts nothing — the hazard `docs/access-model.md`'s re-runnability
-- section lists for `0012`, `0025`, `0026`, `0027` and `0007`.

-- ---------------------------------------------------------------------------
-- 1. The record
-- ---------------------------------------------------------------------------

create table if not exists public.invitations (
  id           uuid primary key default extensions.gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,

  -- The secret, as a digest and never as the code. See section 1 of the header
  -- for the decision and what it costs. `bytea` rather than text because
  -- `digest()` returns one and encoding it would be a second representation to
  -- keep in step; unique so redemption is one index lookup and so two mints
  -- cannot collide silently.
  token_hash   bytea not null,
  constraint invitations_token_hash_unique unique (token_hash),

  -- Who minted it. Nullable, and null MEANS "the organizer who minted this has
  -- since left the household" — the attribution shape every table here uses
  -- since the charter's 2026-08-26 leave/close decision. Never null at insert:
  -- the insert policy below requires it to be the caller's own member row.
  created_by_member_id uuid,

  created_at   timestamptz not null default now(),

  -- Every invitation expires. There is no unbounded row: a code that works
  -- forever is a credential nobody remembers issuing, and #172 lists the expiry
  -- beside each outstanding invitation so the organizer can see it.
  expires_at   timestamptz not null,
  constraint invitations_expires_after_creation check (expires_at > created_at),

  -- Withdrawal and redemption are two different ends, and a row may reach only
  -- one of them. Both are stamps from the database clock, written by nobody but
  -- the organizer's withdrawal (#172) and the function below.
  withdrawn_at timestamptz,
  redeemed_at  timestamptz,
  redeemed_by_member_id uuid,
  constraint invitations_not_both_ends
    check (withdrawn_at is null or redeemed_at is null),

  -- The redeemed stamp and the member it created move together or not at all —
  -- the whole-stamp form `0032`'s purchase columns use. A row carrying one
  -- without the other is a redemption nobody can attribute or a member nobody
  -- can date.
  constraint invitations_redeemed_whole
    check ((redeemed_at is null) = (redeemed_by_member_id is null)),

  -- COMPOSITE, for `0010`'s reason: the member and the household a row claims
  -- must be the same household, so a row pairing one family's person with
  -- another family's id cannot exist. `set null (member_id)` with the COLUMN
  -- LIST — the bare form nulls `household_id` too and the member's delete is
  -- refused (`0032`'s measured correction, recorded in cairn twice).
  constraint invitations_creator_in_household
    foreign key (created_by_member_id, household_id)
    references public.members (id, household_id) on delete set null (created_by_member_id),

  -- The redeemer's row is in this household by construction — the function
  -- creates it there — and the same composite rule applies. Set null rather
  -- than cascade: a member who later leaves must not take the record of their
  -- own admission with them, because that record is how the household knows an
  -- invitation was spent.
  constraint invitations_redeemer_in_household
    foreign key (redeemed_by_member_id, household_id)
    references public.members (id, household_id) on delete set null (redeemed_by_member_id)
);

comment on table public.invitations is
  'One row per invitation to a household: the SHA-256 digest of the code, who '
  'minted it, when it expires, and whether it was withdrawn or redeemed. The '
  'code itself is stored nowhere - it is shown once at mint and can never be '
  'recovered (story #171, AC 4, owner decision 2026-09-10). Holds no invitee '
  'name or address: the recipient names themselves at redemption (#191). '
  'Readable and writable by the household''s organizer alone; redeemed through '
  'redeem_invitation, which is the only route that can create a member row in a '
  'household the caller is not yet in. Story #171.';

comment on column public.invitations.token_hash is
  'extensions.digest(code, ''sha256'') of the invitation code. The plaintext is '
  'never stored, so an outstanding invitation cannot be re-displayed and a '
  'reader of this table holds nothing spendable - docs/data-outside-production.md '
  'Decision 3 control 6, applied to a bearer secret this schema mints itself.';

-- The organizer's list (#172 AC 3) reads this household's outstanding rows,
-- newest first. `household_id` alone would do; the created_at column is in the
-- index because the list is ordered by it and the index then answers both.
create index if not exists invitations_household_created_idx
  on public.invitations (household_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Row-level security — which ROWS
--
-- Four policies, all organizer-only, and all carrying BOTH predicates: the
-- household clause that every table here reads through, and `0002`'s organizer
-- predicate that `0016` established for the other organizer-only act. Either
-- alone would be sufficient; the pair is `0016`'s shape, so a change to one
-- leaves the other standing.
--
-- There is NO policy admitting a non-member to any row. A person redeeming a
-- code never reads this table at all — `redeem_invitation` is `security
-- definer` and reads it on their behalf, which is what makes Decision 4's
-- clause 3 structural here rather than a rule a screen must remember.
--
-- No DELETE policy and no delete grant: an invitation is WITHDRAWN, never
-- removed, so the household keeps the record of what it issued. A row leaves
-- only with its household.
-- ---------------------------------------------------------------------------

alter table public.invitations enable row level security;

drop policy if exists invitations_select_organizer on public.invitations;
create policy invitations_select_organizer
  on public.invitations for select to authenticated
  using (
    household_id in (select public.current_household_ids())
    and public.is_household_organizer(household_id)
  );

-- The row is pinned to the caller's OWN member row, `0038`'s device: the
-- subquery runs under `members`' own policies as the caller, so a housemate's
-- id fails the match and nobody can mint an invitation as somebody else.
drop policy if exists invitations_insert_organizer on public.invitations;
create policy invitations_insert_organizer
  on public.invitations for insert to authenticated
  with check (
    household_id in (select public.current_household_ids())
    and public.is_household_organizer(household_id)
    and created_by_member_id is not null
    and created_by_member_id in (
      select m.id from public.members m
      where m.household_id = invitations.household_id
        and m.claimed_by = (select auth.uid())
    )
  );

-- Withdrawal (#172 AC 4) is an update of one column, and the column grant below
-- is what bounds it to that column. The `with check` repeats the `using`
-- predicate so an update cannot move a row to another household.
drop policy if exists invitations_update_organizer on public.invitations;
create policy invitations_update_organizer
  on public.invitations for update to authenticated
  using (
    household_id in (select public.current_household_ids())
    and public.is_household_organizer(household_id)
  )
  with check (
    household_id in (select public.current_household_ids())
    and public.is_household_organizer(household_id)
  );

-- ---------------------------------------------------------------------------
-- 3. Privileges — which COLUMNS, and for whom
--
-- Revokes first, naming all three roles (`0036`'s form), then grants by name.
-- No narrow revoke anywhere — see section 7 of the header, and `0013`, which is
-- the file that exists because of one.
-- ---------------------------------------------------------------------------

revoke all on public.invitations from authenticated, anon, public;

-- Every column, by name — the `0014` route, because #172's list reads this
-- table BY HOUSEHOLD and a client must be able to name the household it means.
-- `token_hash` IS readable, and that is safe by construction rather than by
-- trust: a digest is not spendable, which is the whole reason section 1 chose
-- it. The policies above are what keep even this from a non-organizer.
grant select (
  id, household_id, token_hash, created_by_member_id, created_at,
  expires_at, withdrawn_at, redeemed_at, redeemed_by_member_id
) on public.invitations to authenticated;

-- `id`, `created_at`, and every stamp the database owns are absent: minting
-- writes the household, the digest, the creator and the expiry, and nothing
-- else. `redeemed_at` and `redeemed_by_member_id` are absent from BOTH the
-- insert and the update grant, so the function below is their only writer -
-- a client cannot mark an invitation redeemed without going through it.
grant insert (household_id, token_hash, created_by_member_id, expires_at)
  on public.invitations to authenticated;

-- One column, for #172's withdrawal. This is the complete client write surface
-- for an existing row.
grant update (withdrawn_at) on public.invitations to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Redemption — the one route that can create a member row in a household
--    the caller is not yet in
-- ---------------------------------------------------------------------------

create or replace function public.redeem_invitation(code text)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  digest bytea;
  target public.invitations;
  joined public.members;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  -- Normalised before hashing, which is #173 AC 8's letter ("different casing
  -- or surrounding whitespace ... is normalised and accepted"). The mint in
  -- #172 must hash the same normalisation, and that is why this is here rather
  -- than in the client: two normalisations in two places is one drift away from
  -- a code that cannot be redeemed.
  digest := extensions.digest(lower(btrim(redeem_invitation.code)), 'sha256');

  -- Identified by the digest, then locked by PRIMARY KEY below. Not locked
  -- through `redeemed_at is null`: a lock taken through a mutable predicate
  -- does not survive the row it matched being retired, and the guarded branch
  -- is then skipped whole (cairn:
  -- a-lock-through-a-mutable-predicate-loses-its-row, `0035`'s correction).
  select i.* into target
  from public.invitations i
  where i.token_hash = digest;

  -- One sentence for four states — no such code, expired, withdrawn, already
  -- redeemed. Decision 4 clause 4: a refusal may say why it refused and never
  -- what it refused, and four distinguishable answers hand somebody guessing
  -- codes an oracle. See section 4 of the header; #173 draws the four messages
  -- from what the person did, not from here.
  if not found
     or target.withdrawn_at is not null
     or target.redeemed_at is not null
     or target.expires_at <= now() then
    raise exception 'that invitation cannot be used';
  end if;

  -- Already inside. Checked BEFORE anything is spent, which is #173 AC 2: the
  -- invitation stays usable by whoever it was meant for. This is the one
  -- refusal that necessarily names the household, and it can only be reached by
  -- somebody already in it.
  if exists (
    select 1 from public.members m
    where m.household_id = target.household_id
      and m.claimed_by = caller
  ) then
    raise exception 'you are already in that household';
  end if;

  -- THE LOCK, by primary key. Everything below runs while this row is held, so
  -- two phones redeeming one code are serialised here and the second reads the
  -- stamp the first wrote.
  select i.* into target
  from public.invitations i
  where i.id = target.id
  for update;

  -- Re-read under the lock. A redemption that committed while we waited is
  -- visible now and was not above, which is the entire reason this is not the
  -- same check twice (AC 6).
  if target.redeemed_at is not null or target.withdrawn_at is not null then
    raise exception 'that invitation cannot be used';
  end if;

  -- The member row. `display_name` is deliberately a placeholder the recipient
  -- replaces: #191's owner decision is that the recipient names themselves at
  -- redemption, and this function has no name to write - nothing in the
  -- invitation carries one. #173's surface collects it and updates the row
  -- through the ordinary client grant.
  insert into public.members (household_id, display_name, weekly_minutes, claimed_by)
  values (target.household_id, 'New member', 0, caller)
  returning * into joined;

  update public.invitations
     set redeemed_at = now(),
         redeemed_by_member_id = joined.id
   where invitations.id = target.id;

  return joined;
end;
$$;

comment on function public.redeem_invitation(text) is
  'Spend an invitation code and join its household: creates the caller''s member '
  'row and stamps the invitation redeemed, under a primary-key lock so one code '
  'admits exactly one person. The only route that can insert into members for a '
  'household the caller is not yet in - members_insert_same_household requires '
  'a membership the redeemer does not have. Refuses an unusable invitation with '
  'ONE sentence for all four states (no such code, expired, withdrawn, already '
  'redeemed) so a refusal cannot confirm a code exists, and refuses an existing '
  'member before spending anything. Story #171.';

-- `from public, anon` — `0032`'s, `0033`'s, `0034`'s and `0035`'s idiom, and
-- the second word is load-bearing on this project: with `from public` alone the
-- live catalog read `anon` STILL HOLDING execute on a new function, reported as
-- a stray by `npm run probe:live-grants` on `0034`'s first apply. No test in
-- this repo can catch it — `from public` alone removes the PUBLIC default,
-- which under pglite is all `anon` has, while the live project holds something
-- the harness never builds. Copy the idiom; do not re-derive it.
revoke all on function public.redeem_invitation(text) from public, anon;
grant execute on function public.redeem_invitation(text) to authenticated;
