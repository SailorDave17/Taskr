-- An upsert writes every column it NAMES, not every column that changes.
--
-- `member_split_seen` (0020) and `member_capacity` (0005) are both written by a
-- PostgREST upsert, and both were granted as though the update half of that
-- upsert touched only the columns whose VALUE moves. It does not. PostgREST
-- compiles `.upsert(payload, { onConflict })` into an `INSERT … ON CONFLICT …
-- DO UPDATE SET` whose SET list is EVERY column in the payload — the conflict
-- target included.
--
-- *Measured* 2026-08-28 against a real PostgREST, read out of the database's
-- own statement log rather than inferred:
--
--   ON CONFLICT("member_id") DO UPDATE SET
--     "member_id" = EXCLUDED."member_id",
--     "seen_rebalance_at" = EXCLUDED."seen_rebalance_at",
--     "snapshot" = EXCLUDED."snapshot"
--
--   ON CONFLICT("member_id", "period_start") DO UPDATE SET
--     "household_id" = EXCLUDED."household_id", "member_id" = EXCLUDED."member_id",
--     "minutes" = EXCLUDED."minutes", "note" = EXCLUDED."note",
--     "period_start" = EXCLUDED."period_start", "source" = EXCLUDED."source"
--
-- Postgres checks privileges when it PLANS that statement, not when a conflict
-- fires, so the refusal does not wait for a second write: the FIRST upsert a
-- member ever makes is refused. 0020's own comment — "`member_id` is
-- insert-only: the update half of an upsert never moves a row to another
-- member" — is a claim about PostgREST that nothing ever executed, and the
-- pglite suite could not have caught it, because its helper is a hand-written
-- mirror of the same belief: it issues the SET list the author expected
-- (`/** The client's write, exactly as PostgREST issues an upsert on the PK. */`)
-- rather than the one PostgREST issues. A double cannot disagree with its
-- author. `src/test/upsert-shape.pglite.test.js` is the instrument that can.
--
-- TWO privileges are needed per payload column, not one:
--
--   UPDATE on the column, because it is a SET target.
--   SELECT on the column, because `EXCLUDED."col"` READS it.
--
-- The SELECT half is what bites `member_capacity.household_id`, which held
-- INSERT and nothing else. Nothing about the app's behaviour suggests that
-- column needs SELECT — it is absent from `CAPACITY_COLUMNS`, so the client
-- never reads it back — and the two faults stack: granting only UPDATE moves
-- the refusal from "GRANT UPDATE" to "GRANT SELECT" in Postgres's own HINT and
-- looks like the fix failing.
--
-- What a member saw, on every open of the split surface and every capacity
-- edit, since 0019 removed the inherited table-level grants that had been
-- masking the column-level scheme:
--
--   recording what you were shown: permission denied for table member_split_seen
--   saving this week's capacity: permission denied for table member_capacity
--
-- The seen-marker failure has a SECOND victim that presents as an unrelated
-- bug. `dismissFairnessNote` is a plain UPDATE on a row whose only writer is
-- the seen-marker upsert, so with no row ever created the "Noted" button
-- refuses with "The dismissal did not land — there is no seen-marker row to
-- record it on yet." Nothing on the dismissal path was ever wrong; it is fixed
-- by fixing the write above it.
--
-- These grants do NOT widen who may write what. RLS is the terminal guard and
-- remains it — *measured* in the same session, with these grants in place, a
-- signed-in member upserting a seen-marker for a HOUSEMATE, and moving their
-- own row to a housemate, are both refused with "new row violates row-level
-- security policy for table member_split_seen". 0020 already measured that its
-- three self-scoped policies stack on the one upsert statement; this file
-- changes the column grants beneath those policies and not the policies.
--
-- Re-runnable: grants are idempotent. The ORDERING hazard 0021 states applies
-- here too and now names two files — re-pasting 0020 AFTER this one strips
-- these column grants, because its `revoke all` takes column-level grants with
-- it and its re-grant names only its own three columns. If 0020 is ever
-- re-applied, re-apply 0021 and then this file after it.

-- ---------------------------------------------------------------------------
-- member_split_seen — the seen-marker upsert (announce.js `writeSplitSeen`)
-- ---------------------------------------------------------------------------
-- `member_id` already carried SELECT, so only the SET-target half is missing.
-- `snapshot` and `seen_rebalance_at` already carry both.
grant update (member_id)
  on public.member_split_seen to authenticated;

-- ---------------------------------------------------------------------------
-- member_capacity — the capacity upsert (capacity.js `setCapacity`)
-- ---------------------------------------------------------------------------
-- `household_id` held INSERT alone and needs both halves; `member_id` and
-- `period_start` are the conflict target and hold SELECT already.
grant select (household_id)
  on public.member_capacity to authenticated;

grant update (household_id, member_id, period_start)
  on public.member_capacity to authenticated;

-- ---------------------------------------------------------------------------
-- The guard those grants would otherwise have taken away
-- ---------------------------------------------------------------------------
-- 0005 held one invariant with a column grant rather than with a rule: by
-- withholding UPDATE on `member_id` and `period_start`, it made "an override
-- cannot be moved to another person or another week" true by privilege. Its
-- test says why, and says it as a REGRESSION — "a household member could hand
-- their own thin week to somebody else and the split would rebalance around a
-- fact nobody stated."
--
-- Granting UPDATE on those columns for the upsert's sake would end that, and
-- RLS does not step in: `member_capacity_update_same_household` is
-- HOUSEHOLD-scoped, so moving a row to a housemate satisfies it. *Measured*
-- 2026-08-28 — with the grants above and this trigger absent, `update
-- public.member_capacity set member_id = <housemate>` SUCCEEDS.
--
-- (`member_split_seen` needs no equivalent. Its three policies are SELF-scoped,
-- so the same two attacks are refused there by RLS with "new row violates
-- row-level security policy" — measured in the same session. The column grant
-- was never what held that line.)
--
-- So the invariant moves from a privilege to a rule, which is where it should
-- have been: a rule says what is forbidden and survives a grant being widened
-- for an unrelated reason, which is exactly what happened here.
--
-- The legitimate upsert passes because the values do not MOVE. The conflict
-- target is `(member_id, period_start)`, so on a matched row
-- `EXCLUDED.member_id` IS `old.member_id`; `household_id` is the household the
-- client is already showing. `is distinct from` rather than `<>` so a NULL on
-- either side compares as data instead of collapsing to NULL and letting the
-- change through.
create or replace function public.member_capacity_identity_is_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.household_id is distinct from old.household_id
     or new.member_id is distinct from old.member_id
     or new.period_start is distinct from old.period_start then
    raise exception
      'a capacity override cannot be moved to another person, week or household'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists member_capacity_identity_is_fixed on public.member_capacity;
create trigger member_capacity_identity_is_fixed
  before update on public.member_capacity
  for each row execute function public.member_capacity_identity_is_fixed();

-- Postgres grants EXECUTE on a new function to PUBLIC, and Supabase's defaults
-- add `anon` BY NAME — which a `revoke … from public` does not reach. 0017
-- section 4 says nothing in `public` is executable by `anon`, and
-- `grants.pglite.test.js` enforces it, so the revoke names all three roles.
-- Same line, same reasoning, as 0018's `note_split_inputs_changed`. A trigger
-- function needs no EXECUTE grant to fire: the privilege is checked when the
-- trigger is CREATED, not each time it runs.
revoke all on function public.member_capacity_identity_is_fixed()
  from public, anon, authenticated;
