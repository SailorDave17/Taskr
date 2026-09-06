-- The household's shopping lists, their runs, and the items on them — story #352.
--
-- The first tables in this schema with no fairness arithmetic behind them. A
-- shopping run completes no chore and counts no minutes; what it shares with
-- everything since `0003` is the discipline — one household as the trust
-- boundary (`0007`/`0014`), every stamp from the database clock (`0004`/`0029`),
-- every privilege granted by name in the same file that creates the table. The
-- charter admits the feature as a standalone household utility in its
-- 2026-09-05 decision section, written by this story; epic #349 carries the
-- owner decisions this file is built from.
--
-- ===========================================================================
-- The shape, and why each of the three tables exists
-- ===========================================================================
--
--   shopping_lists   a named list a household keeps — "Groceries", "Hardware".
--                    Several per household (owner decision 5 on the epic,
--                    against the one-list recommendation), unique by name
--                    case-insensitively within the household.
--   shopping_runs    one trip. A list has exactly ONE open run at a time (the
--                    partial unique index below is what makes that a
--                    constraint rather than a convention), and closing a run
--                    is #354's `finish_shopping_run`, NOT this file — that RPC
--                    is the hardest function in the epic and is kept out of
--                    this migration on purpose so the schema lands at its own
--                    size.
--   shopping_items   what somebody wants bought, on one run. Stamped with who
--                    added it and when, who bought it and when, and — for an
--                    item #354 carries forward from a finished run — which
--                    item it came from.
--
-- "Current run" is written as `closed_at is null` EVERYWHERE below, never as
-- `max(opened_at)`. Taskr #98 over #96 is the record of what happens when a
-- predicate means one thing while the schema admits one state and quietly
-- means another when a later story admits two; #354 and #359 (past runs) will
-- both add states, and a `closed_at is null` predicate survives them.
--
-- ===========================================================================
-- Who writes what — the stamp columns are the database's alone
-- ===========================================================================
--
-- `0004` set the rule for `chores.completed_at` and `0029` restated it: a
-- timestamp that says WHEN something happened is written from `now()` inside a
-- `security definer` function, never accepted from a phone whose clock is
-- whatever it is. The same goes for WHO — `acting_member(household)` resolves
-- the caller's member row and a client that could write `added_by_member_id`
-- could attribute an item to a housemate.
--
-- So `authenticated` holds NO insert grant on any of the three tables, and NO
-- update grant on `added_by_member_id`, `added_at`, `purchased_at`,
-- `purchased_by_member_id`, `closed_at` or `closed_by_member_id`. Creation and
-- every stamp go through the four RPCs at the foot of this file:
--
--   create_shopping_list(household, name)  -> the list AND its first open run,
--                                             in one transaction. This is why
--                                             there is no client insert on
--                                             `shopping_lists`: a direct insert
--                                             would produce a runless list.
--   add_shopping_item(run, name, note)     -> stamps added_by / added_at.
--   purchase_shopping_item(item)           -> stamps purchased_by / purchased_at,
--                                             `for update`, refuses a re-stamp.
--   unpurchase_shopping_item(item)         -> clears exactly those two columns.
--
-- What the client DOES hold directly, and why each is safe to hold:
--
--   * select, column by column, INCLUDING `household_id`, on all three. The
--     `0014` route: the Shop tab reads "this household's lists" by naming the
--     household, then runs by list and items by run — three plain filters, no
--     embed filter (cairn: a filter on an embedded resource nulls the embed and
--     keeps the parent, so the row count never moves). Granting the scoping
--     column is what lets the client say which household it means.
--   * update (name) on `shopping_lists` — renaming a list is roster-grade
--     maintenance, the same class as `members.display_name`.
--   * delete on `shopping_items`, under a policy that admits ONLY an unbought
--     item on an open run (owner decision, 2026-09-05: any member may remove
--     one). Bought items are history and closed runs are the record #359
--     shows; neither is deletable from a phone.
--
-- ===========================================================================
-- What a removed member leaves behind, and what a deleted list takes with it
-- ===========================================================================
--
-- The charter's 2026-08-26 leave/close decision, applied: attribution FKs are
-- `on delete set null`, so a member row's deletion leaves every item they
-- added, bought or run they closed standing with the stamp column null — the
-- list is the household's, not the member's. Structural FKs are `on delete
-- cascade`, so a list deleted by SQL takes its runs and its items with it, and
-- a run deleted by SQL takes its items. `carried_from_item_id` is
-- attribution-shaped (which item did this come from) and so is `set null`:
-- deleting the closed run an item was carried from must not delete the item
-- that is still wanted.
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- Applied by `npm run migrate:live` or a hand paste; a re-paste is the normal
-- path (`0001`'s header describes it). Every table is `create table if not
-- exists` with its constraints INLINE — on a re-run the whole statement is
-- skipped, constraints with it — every index `if not exists`, every policy
-- `drop policy if exists` before `create policy`, every function `create or
-- replace`, and grants are idempotent by nature. Re-runnable against the schema
-- this file was written for, which is the only claim any migration here makes;
-- `shopping.pglite.test.js` applies it twice to prove it.

-- ---------------------------------------------------------------------------
-- 1. The tables
-- ---------------------------------------------------------------------------

create table if not exists public.shopping_lists (
  id           uuid primary key default extensions.gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null,
  created_at   timestamptz not null default now(),

  constraint shopping_lists_name_present check (length(btrim(name)) > 0)
);

comment on table public.shopping_lists is
  'A named shopping list a household keeps. Several per household, one open '
  'run each. Created only through create_shopping_list, which opens the first '
  'run in the same transaction — a direct insert would produce a runless list, '
  'which is why the client holds no insert grant here. Story #352.';

-- Two lists named `groceries` and `Groceries` are one list typed twice.
create unique index if not exists shopping_lists_household_name_key
  on public.shopping_lists (household_id, lower(name));

create table if not exists public.shopping_runs (
  id                  uuid primary key default extensions.gen_random_uuid(),
  list_id             uuid not null references public.shopping_lists (id) on delete cascade,
  -- Denormalised from the list ON PURPOSE. Every policy in this schema is
  -- `household_id in (select current_household_ids())`, and a policy that had
  -- to join through `shopping_lists` to find the household would be the one
  -- policy written differently from the other forty — and the one a reader
  -- would have to reason about instead of pattern-match.
  household_id        uuid not null references public.households (id) on delete cascade,
  opened_at           timestamptz not null default now(),
  closed_at           timestamptz,
  closed_by_member_id uuid,

  -- A closer without a close is a run in a state no function here writes, and
  -- is refused at the row. The converse — a close with NO closer — is a real
  -- state: the member who closed it has since been removed, and the FK below
  -- blanks the who and keeps the when. So the constraint is one-directional on
  -- purpose; `(closed_at is null) = (closed_by_member_id is null)` would make
  -- removing a member fail on every run they ever closed. *Measured* in pglite
  -- before this file was applied anywhere: the symmetric form refused the
  -- member delete with `null value in column "household_id"` — see the FK.
  constraint shopping_runs_closer_implies_close
    check (closed_by_member_id is null or closed_at is not null),

  -- COMPOSITE, for `0010`/`0011`/`0030`'s reason: the closer and the household
  -- this run claims must be the same household. `set null`, not cascade — the
  -- run is the household's record of a trip, and outlives whoever closed it.
  --
  -- THE COLUMN LIST IS LOAD-BEARING, and this schema already said so. A
  -- composite FK's `on delete set null` nulls EVERY referencing column —
  -- `household_id` included — which is `not null` here, so the member delete
  -- would be refused and the roster could never lose anybody who had closed a
  -- run. `0006` wrote `on delete set null (assigned_member_id)` and its comment
  -- carries the reason; `0012` and `0018` repeat the form. This file's first
  -- draft still wrote the bare form, because its template was `0030` — the
  -- nearest migration that CREATES a table with a composite member FK, and
  -- that one cascades — and the pglite member-delete test refused it on the
  -- first run. migrations.pglite.test.js now asks the catalog that every
  -- composite set-null FK names its columns, so the next table cannot make the
  -- same choice quietly. The hosted project is Postgres 17.6 (read before the
  -- apply and recorded in docs/access-model.md's `0032` entry).
  constraint shopping_runs_closer_in_household
    foreign key (closed_by_member_id, household_id)
    references public.members (id, household_id) on delete set null (closed_by_member_id)
);

comment on table public.shopping_runs is
  'One shopping trip against one list. A list has at most ONE open run '
  '(closed_at null) — shopping_runs_one_open_per_list — and the open run is '
  'always written as `closed_at is null`, never as the latest opened_at. '
  'Closed by finish_shopping_run (#354), never by a client write. Story #352.';

-- One open run per list, as a CONSTRAINT. A second `insert` with `closed_at`
-- null for the same list is refused by Postgres, whatever code issued it.
create unique index if not exists shopping_runs_one_open_per_list
  on public.shopping_runs (list_id) where closed_at is null;

create index if not exists shopping_runs_household_idx
  on public.shopping_runs (household_id);

create table if not exists public.shopping_items (
  id                     uuid primary key default extensions.gen_random_uuid(),
  run_id                 uuid not null references public.shopping_runs (id) on delete cascade,
  household_id           uuid not null references public.households (id) on delete cascade,
  name                   text not null,
  note                   text,
  added_by_member_id     uuid,
  added_at               timestamptz not null default now(),
  purchased_at           timestamptz,
  purchased_by_member_id uuid,
  -- #354: an item carried forward from a finished run points at the item it
  -- came from. Null for an item somebody typed. `set null` because the origin
  -- run's deletion must not delete a thing still wanted.
  carried_from_item_id   uuid references public.shopping_items (id) on delete set null,

  constraint shopping_items_name_present check (length(btrim(name)) > 0),

  -- A buyer implies a purchase, one-directional for the run constraint's
  -- reason: a purchase whose buyer has since left the household keeps its
  -- time and loses its who.
  constraint shopping_items_buyer_implies_purchase
    check (purchased_by_member_id is null or purchased_at is not null),

  -- COMPOSITE, both attribution FKs: the adder and the buyer belong to the
  -- household the item is in. `set null` — a removed member's items stay on
  -- the list (charter, 2026-08-26), and history keeps the purchase with the
  -- stamp blanked rather than losing the row. Column lists for the reason the
  -- run's FK gives: without them the delete nulls `household_id` too and is
  -- refused.
  constraint shopping_items_adder_in_household
    foreign key (added_by_member_id, household_id)
    references public.members (id, household_id) on delete set null (added_by_member_id),

  constraint shopping_items_buyer_in_household
    foreign key (purchased_by_member_id, household_id)
    references public.members (id, household_id) on delete set null (purchased_by_member_id)
);

comment on table public.shopping_items is
  'One thing somebody wants bought, on one run. added_by/added_at and '
  'purchased_by/purchased_at are written only by the RPCs from the database '
  'clock; the client holds no insert grant and no update grant on any stamp '
  'column. Deletable by any member only while unbought on an open run. '
  'Story #352.';

create index if not exists shopping_items_run_idx
  on public.shopping_items (run_id);

create index if not exists shopping_items_household_idx
  on public.shopping_items (household_id);

-- ---------------------------------------------------------------------------
-- 2. Row-level security — which ROWS
--
-- The household is the trust boundary and inside it everyone sees everything,
-- which for a shopping list is the feature: "everyone in the household can add
-- to one shared list" is the epic's first sentence. One predicate, the same
-- one every table since `0007` uses.
--
-- There is deliberately NO insert policy on any of the three tables and NO
-- update policy on `shopping_runs` or `shopping_items`: with no matching grant
-- a policy would be inert, and an inert policy is a second way in waiting for
-- a grant to arrive. The definer functions below bypass row-level security
-- (they run as the owner) and check membership themselves, by the same
-- `current_household_ids()`.
-- ---------------------------------------------------------------------------

alter table public.shopping_lists enable row level security;
alter table public.shopping_runs  enable row level security;
alter table public.shopping_items enable row level security;

drop policy if exists shopping_lists_select_same_household on public.shopping_lists;
create policy shopping_lists_select_same_household
  on public.shopping_lists for select to authenticated
  using (household_id in (select public.current_household_ids()));

drop policy if exists shopping_lists_update_same_household on public.shopping_lists;
create policy shopping_lists_update_same_household
  on public.shopping_lists for update to authenticated
  using (household_id in (select public.current_household_ids()))
  with check (household_id in (select public.current_household_ids()));

drop policy if exists shopping_runs_select_same_household on public.shopping_runs;
create policy shopping_runs_select_same_household
  on public.shopping_runs for select to authenticated
  using (household_id in (select public.current_household_ids()));

drop policy if exists shopping_items_select_same_household on public.shopping_items;
create policy shopping_items_select_same_household
  on public.shopping_items for select to authenticated
  using (household_id in (select public.current_household_ids()));

-- Any household member may remove an UNBOUGHT item from an OPEN run (owner
-- decision, 2026-09-05). One predicate, no per-member rule: the adder has no
-- more claim on a line than anyone else who shares the cart. A bought item is
-- history and a closed run is the record, so neither is reachable from here —
-- and a delete that matches such a row affects ZERO rows rather than raising,
-- which is how row-level security refuses.
drop policy if exists shopping_items_delete_unbought_on_open_run on public.shopping_items;
create policy shopping_items_delete_unbought_on_open_run
  on public.shopping_items for delete to authenticated
  using (
    household_id in (select public.current_household_ids())
    and purchased_at is null
    and exists (
      select 1 from public.shopping_runs r
      where r.id = shopping_items.run_id
        and r.closed_at is null
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Privileges — which COLUMNS, and for whom
--
-- The revokes come first and name `anon` for `0002`'s reason: no policy above
-- targets it, so it reaches no row today, and that is one `to anon` away from
-- being false. On a fresh table the platform's default already holds no DML
-- (#91, `0030`'s comment), so the revoke is the house convention rather than
-- the thing refusing a client write — stated so a mutation pass is read
-- correctly.
--
-- `household_id` IS in every select list. The `0014` route, and the reasoning
-- is the docblock's: the client scopes lists by naming the household, and a
-- withheld column here would force the embed filter the cairn note rules out.
-- The cost `0014` paid on `members` — `select('*')` no longer failing — is paid
-- on all three tables here, because every column of each is readable: a
-- shopping list has nothing on it the household may not see. What survives is
-- the property `0014` kept on `members`: THE GRANT IS PER COLUMN AND EVERY
-- COLUMN IS NAMED, so a column a later migration adds is a decision somebody
-- takes rather than an automatic exposure. shopping.pglite.test.js asserts the
-- shape (no table-level select) on all three.
-- ---------------------------------------------------------------------------

revoke all on public.shopping_lists from authenticated, anon;
revoke all on public.shopping_runs  from authenticated, anon;
revoke all on public.shopping_items from authenticated, anon;

grant select (id, household_id, name, created_at)
  on public.shopping_lists to authenticated;

-- Renaming is the ONE direct write on a list. `household_id` is not updatable —
-- a list does not move house — and there is no insert grant at all (see the
-- docblock: creation opens the first run, so it is create_shopping_list's).
grant update (name)
  on public.shopping_lists to authenticated;

-- Read-only from the client. `closed_at` and `closed_by_member_id` are
-- readable — the Shop tab's `closed_at is null` filter needs the first, and
-- #359's past runs need both — and writable by nothing but #354's RPC.
grant select (id, list_id, household_id, opened_at, closed_at, closed_by_member_id)
  on public.shopping_runs to authenticated;

-- Every column readable, no column writable, and one whole-row delete under
-- the policy above. `name` and `note` are NOT updatable either — an item is
-- removed and re-added rather than edited, which keeps "who added it" honest;
-- if editing is ever wanted it is a grant on exactly those two, here.
grant select (id, run_id, household_id, name, note, added_by_member_id, added_at,
              purchased_at, purchased_by_member_id, carried_from_item_id)
  on public.shopping_items to authenticated;

grant delete on public.shopping_items to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The RPCs — the only writers of a list, an item, or a stamp
--
-- Every one is `security definer` with `set search_path = ''`, resolves the
-- caller's membership through `current_household_ids()` and the caller's
-- member row through `acting_member()` — `0004`'s pair — and raises a sentence
-- the client can show. Argument names are the contract: PostgREST resolves an
-- overload by the SET of argument names, and `LIVE_RPCS` in
-- src/lib/liveSchema.js carries each signature so `check:live` can ask for it.
--
-- A parameter named `name` beside a column named `name` is ambiguous inside
-- plpgsql, and Postgres refuses the statement rather than guessing. Every
-- column below is table-qualified and every parameter is function-qualified
-- (`create_shopping_list.name`), so the two can never be read as one another.
-- ---------------------------------------------------------------------------

-- The list and its first open run, in one transaction, returning the list.
create or replace function public.create_shopping_list(household uuid, name text)
returns public.shopping_lists
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  list_name text := btrim(create_shopping_list.name);
  made public.shopping_lists;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  if list_name is null or list_name = '' then
    raise exception 'a list needs a name';
  end if;

  if create_shopping_list.household is null
     or create_shopping_list.household not in (select public.current_household_ids()) then
    raise exception 'no such household for this member';
  end if;

  insert into public.shopping_lists (household_id, name)
  values (create_shopping_list.household, list_name)
  returning * into made;

  -- The first run. A list with no open run is a state nothing here writes and
  -- the Shop tab could not draw, which is the whole reason creation is an RPC.
  insert into public.shopping_runs (list_id, household_id)
  values (made.id, made.household_id);

  return made;
end;
$$;

comment on function public.create_shopping_list(uuid, text) is
  'Create a named list in the caller''s household and open its first run in '
  'the same transaction. The only writer of shopping_lists rows. Story #352.';

-- An item on an open run in the caller's household, stamped from the clock.
create or replace function public.add_shopping_item(run uuid, name text, note text)
returns public.shopping_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  item_name text := btrim(add_shopping_item.name);
  item_note text := nullif(btrim(add_shopping_item.note), '');
  target public.shopping_runs;
  made public.shopping_items;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  if item_name is null or item_name = '' then
    raise exception 'an item needs a name';
  end if;

  select r.* into target
  from public.shopping_runs r
  where r.id = add_shopping_item.run
    and r.household_id in (select public.current_household_ids());

  if not found then
    raise exception 'no such run in your household';
  end if;

  if target.closed_at is not null then
    raise exception 'run already closed';
  end if;

  -- The adder and the time are the database's: no timestamp in the signature,
  -- and the member resolved from the caller, not named by them.
  insert into public.shopping_items (run_id, household_id, name, note, added_by_member_id, added_at)
  values (target.id, target.household_id, item_name, item_note,
          public.acting_member(target.household_id), now())
  returning * into made;

  return made;
end;
$$;

comment on function public.add_shopping_item(uuid, text, text) is
  'Add an item to an open run in the caller''s household, stamped with the '
  'caller''s member row and the database clock. The only writer of '
  'shopping_items rows other than #354''s rollover. Story #352.';

-- Bought. `for update` so two phones ticking one item keep the FIRST stamp:
-- the second waits on the lock, re-reads the now-purchased row, and is refused.
create or replace function public.purchase_shopping_item(item uuid)
returns public.shopping_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target public.shopping_items;
  run_closed_at timestamptz;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  select i.* into target
  from public.shopping_items i
  where i.id = purchase_shopping_item.item
    and i.household_id in (select public.current_household_ids())
  for update of i;

  if not found then
    raise exception 'no such item in your household';
  end if;

  select r.closed_at into run_closed_at
  from public.shopping_runs r
  where r.id = target.run_id;

  if run_closed_at is not null then
    raise exception 'run already closed';
  end if;

  if target.purchased_at is not null then
    raise exception 'item already bought';
  end if;

  update public.shopping_items
     set purchased_at = now(),
         purchased_by_member_id = public.acting_member(target.household_id)
   where id = target.id
  returning * into target;

  return target;
end;
$$;

comment on function public.purchase_shopping_item(uuid) is
  'Mark an item bought, stamped with the caller''s member row and the database '
  'clock, under a row lock so the first of two simultaneous ticks wins and the '
  'second is refused rather than re-stamping. Story #352.';

-- Not bought after all. Clears EXACTLY the two columns purchase wrote — the
-- `0029` uncomplete discipline — and is callable by any member of the
-- household, not only the buyer: the cart is shared and so is the mistake.
create or replace function public.unpurchase_shopping_item(item uuid)
returns public.shopping_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target public.shopping_items;
  run_closed_at timestamptz;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  select i.* into target
  from public.shopping_items i
  where i.id = unpurchase_shopping_item.item
    and i.household_id in (select public.current_household_ids())
  for update of i;

  if not found then
    raise exception 'no such item in your household';
  end if;

  select r.closed_at into run_closed_at
  from public.shopping_runs r
  where r.id = target.run_id;

  if run_closed_at is not null then
    raise exception 'run already closed';
  end if;

  update public.shopping_items
     set purchased_at = null,
         purchased_by_member_id = null
   where id = target.id
  returning * into target;

  return target;
end;
$$;

comment on function public.unpurchase_shopping_item(uuid) is
  'Take back a purchase: purchased_at and purchased_by_member_id return to '
  'null and nothing else on the row moves. Any household member may. '
  'Story #352.';

-- ---------------------------------------------------------------------------
-- 5. Function privileges
--
-- `0010`'s shape: revoke from public and anon so the intent is readable rather
-- than inherited, then grant execute to the one role that calls them.
-- ---------------------------------------------------------------------------

revoke all on function public.create_shopping_list(uuid, text)      from public, anon;
revoke all on function public.add_shopping_item(uuid, text, text)   from public, anon;
revoke all on function public.purchase_shopping_item(uuid)          from public, anon;
revoke all on function public.unpurchase_shopping_item(uuid)        from public, anon;

grant execute on function public.create_shopping_list(uuid, text)    to authenticated;
grant execute on function public.add_shopping_item(uuid, text, text) to authenticated;
grant execute on function public.purchase_shopping_item(uuid)        to authenticated;
grant execute on function public.unpurchase_shopping_item(uuid)      to authenticated;
