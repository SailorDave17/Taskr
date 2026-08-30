-- What each member was last shown — story #50 AC 2.
--
-- The announcement is defined as WHAT CHANGED SINCE THIS MEMBER LAST LOOKED,
-- and that definition cannot be met by anything already in the schema:
-- `households.last_rebalance` (0018) records what the last RUN did, which is
-- one fact per household, and two members who last looked at different times
-- must receive different statements. So the before-state is per member, and
-- this table is that record — the issue's "second story hiding inside this
-- one", kept beside the announcement because the marker has no meaning
-- outside it.
--
-- One row per member, written by that member's own client each time the split
-- is shown to them:
--
--   - `snapshot`  — the per-member minutes the bars drew, produced by the SAME
--     `assess` call the split renders from (#50 AC 4: the sentence and the
--     picture cannot disagree, because they are diffs of one arithmetic).
--   - `seen_rebalance_at` — the `applied_at` of the last re-balance this member
--     has been SHOWN a statement about (or seen the state of). Null means no
--     re-balance had happened when they last looked. The announcement shows
--     exactly when `last_rebalance.applied_at` is newer than this mark, which
--     is what makes it an event seen once rather than a standing banner
--     (#50 AC 7).
--
-- Deliberately NOT an allocator input: no `note_split_inputs_changed` trigger
-- is attached, because a member recording what they saw must not bump
-- `assignments_version` — it would refuse a concurrent apply over a write that
-- cannot change any allocation.
--
-- Like `member_capacity`, `chore_exclusions` and `calendar_connections`, the
-- table withholds `household_id`: it is scoped by the member set, and a member
-- id names a household by construction.
--
-- Re-runnable: applied by `npm run migrate:live` or a hand paste, so a second
-- application must be a no-op. `create table if not exists`, `drop policy if
-- exists`, and the revoke/grant pairs are idempotent by nature.

create table if not exists public.member_split_seen (
  member_id         uuid primary key references public.members (id) on delete cascade,
  snapshot          jsonb not null,
  seen_rebalance_at timestamptz,

  constraint member_split_seen_snapshot_is_object
    check (jsonb_typeof(snapshot) = 'object')
);

alter table public.member_split_seen enable row level security;

-- SELF-scoped, not household-scoped, in all three policies — narrower than
-- every other table here, on purpose. What a member was last shown feeds only
-- that member's own announcement; no other row in the household reads it, so
-- no other row may. A household-scoped write policy would also let one phone
-- silently mark another member's announcement as seen, which is the one thing
-- this table exists to prevent.
--
-- The three scopes STACK on the client's one statement, and that was measured
-- rather than assumed (#50's mutation pass): an `insert … on conflict do
-- update` proposes a row that Postgres checks against the UPDATE policy and
-- the SELECT policy's USING as well as the INSERT check — so widening the
-- insert check alone changed nothing, widening insert AND update changed
-- nothing, and only widening all three let a cross-member upsert through
-- (0, 0, then 4 tests red). Narrowing any one of them back is enough for the
-- upsert path, and the select scope is the terminal guard.

drop policy if exists member_split_seen_select_own on public.member_split_seen;
create policy member_split_seen_select_own
  on public.member_split_seen for select to authenticated
  using (
    member_id in (
      select m.id from public.members m
      where m.claimed_by = (select auth.uid())
    )
  );

drop policy if exists member_split_seen_insert_own on public.member_split_seen;
create policy member_split_seen_insert_own
  on public.member_split_seen for insert to authenticated
  with check (
    member_id in (
      select m.id from public.members m
      where m.claimed_by = (select auth.uid())
    )
  );

drop policy if exists member_split_seen_update_own on public.member_split_seen;
create policy member_split_seen_update_own
  on public.member_split_seen for update to authenticated
  using (
    member_id in (
      select m.id from public.members m
      where m.claimed_by = (select auth.uid())
    )
  )
  with check (
    member_id in (
      select m.id from public.members m
      where m.claimed_by = (select auth.uid())
    )
  );

-- Privileges. On a current hosted project a fresh table gives every Data API
-- role `Dxtm` and no DML; on this project, which predates the tightening, it
-- would inherit more (`0019`'s whole subject) — so the revoke is issued either
-- way and the grants below are the complete client surface (0013's convention:
-- adding a column is a decision, not an automatic exposure).
--
-- No DELETE grant and no delete policy: a seen-marker is corrected by the next
-- upsert and dies with its member row (`on delete cascade`). No `service_role`
-- grant either, and unlike 0011 that is not an omission to fix later — no Edge
-- Function or server path reads what a member was last shown.
revoke all on public.member_split_seen from authenticated, anon;

grant select (member_id, snapshot, seen_rebalance_at)
  on public.member_split_seen to authenticated;

-- The client writes with an upsert on the primary key, so both halves are
-- granted. `member_id` is insert-only: the update half of an upsert never
-- moves a row to another member.
grant insert (member_id, snapshot, seen_rebalance_at)
  on public.member_split_seen to authenticated;

grant update (snapshot, seen_rebalance_at)
  on public.member_split_seen to authenticated;
