# Access model — how a household joins, and what that actually protects

- Date: 2026-08-05, substantially revised 2026-08-06, **superseded again 2026-08-11 by story #62**
- Decided by: owner (SailorDave17), at pickup of story #5, overridden at pickup of story #23, and
  again at pickup of #62
- Story: #5 (schema, policies, the bypass test), #23 (per-member credentials, column grants),
  #34 (chores, which inherits the column-grant convention), #36 (assignment, which is the first
  to make the convention's rule structural as well as procedural) and **#62 (per-member sign-in,
  which retires device auth entirely)**
- Status: **`0001`–`0036` are ALL applied to the live project (`0036` on 2026-09-07
  in #208's own session, at md5 `d65fb95c299101c5ca9d3c6cc01b0584` (`6082 characters, 6 statements`), read back identical
  — see its entry below; `0035` on 2026-09-06 in #360's own
  session, at md5 `50a3d5426afb4a55520b16940fd95349` (`21827 characters, 15 statements`), read back
  identical — see its entry below; `0034` on 2026-09-06 in #368's own
  session, at md5 `354cca29db27f04dbd5ac7e07e9562d3` (9045 characters, 6 statements), read back
  identical — **applied twice**, and the reason is the entry below; `0033` on 2026-09-05 in #354's own
  session, before the merge — see its entry below; `0032` the same day in #352's and `0031` in #97's), and **the expected-red set is
  EMPTY again as of 2026-09-08** — #99 adds
  NO migration and one Edge Function, `calendar-disconnect`, so its row is a deploy's and never a
  paste's: *measured **48 of 49** immediately before `npm run deploy:function` and
  **49 of 49** immediately after* in #99's own session, the denominator having moved
  from 48 to 49 on the one new function. Its whole history is the #99 bullet in the excused-red
  table below. Every red, on any subject, is real.** Before that the set was
  EMPTY as of 2026-09-07 — *measured **47 of 48** immediately before
  `npm run deploy:function` shipped `extract-description` in #209's own session and **48 of 48**
  immediately after*, the denominator unmoved because that row had existed since #210 listed the
  name. Its whole history is the #210 bullet in the excused-red table below, now closed. Before that the set held ONE
  row — `extract-description`, the Edge Function #210's capture flow invokes, WRITTEN by #208 on
  2026-09-07 and DEPLOYED by #209 on 2026-09-07: *measured 2026-09-04 at 36 of 36 immediately before
  the name was listed and 36 of 37 immediately after*, in #210's own session, and *measured 47 of 48
  on both sides of
  `0036`'s apply* in #208's, that file adding no row the check has (its table is one no client
  reads). Before #210, the set was EMPTY — *measured 2026-09-04 at 36 of 36*
  in #100's session, after `0030` was applied and `calendar-busy` deployed there (34 of 36
  immediately before, exactly #96's two rows red; see the `0030` entry below). Up to `0029`, and at
  the moment `0029` landed, that set was EMPTY too —
  *measured 2026-09-02 at 32 of 32*, on both sides of `0029`'s apply in its own story's session
  (below), and at the same figure on both sides of `0028`'s earlier the same day, and on 2026-09-01
  after `0027` was applied in its.
  *(This range read `0001`–`0023` until 2026-08-31 while the entries below already recorded `0024`
  and `0025` applied — the headline is a second copy of what its own detail says, and it is the copy
  a reader acts on, so it is now bumped in the same edit that adds an entry.)* The denominator
  history: it moved to 28 when #250 added two rows asking whether the SEEDED TEST ACCOUNT can still
  sign in — the first time it moved on something a migration cannot change, and nothing became
  excusable: those rows are green whenever the account works.
  **`0035` on 2026-09-06 (#360, archiving a shopping list)**, applied with `npm run migrate:live`
  in the story's own session, before the merge and the `release` promotion — `0020`'s safe order —
  at md5 `50a3d5426afb4a55520b16940fd95349` (`21827 characters, 15 statements`), read back identical.
  One nullable COLUMN (`shopping_lists.archived_at`) with a SELECT grant for `authenticated` and
  no write grant for anybody, two NEW `security definer` functions with `search_path` emptied
  (`archive_shopping_list`, `unarchive_shopping_list`) executable by `authenticated` and not by
  `anon`, and `0032`/`0033`'s `add_shopping_item` and `0033`'s `finish_shopping_run` REPLACED at
  their exact signatures to refuse an archived list. No policy changes and no other grant moves.
  **`check:live` is NOT blind to this one, in two ways at once**: two new argument sets moved the
  denominator from 46 to **48** and both rows were red on purpose, and the new column turned the
  EXISTING `shopping_lists` table row red (`42703`) without moving the denominator, because a table
  is probed once with every column the app selects — *measured
  **44 of 48** immediately before* (three reds of `0035`'s making plus
  the standing `extract-description`) and *measured **47 of 48**
  immediately after*. What it cannot see is the half that matters most here — that the stamp is
  readable and writable by NO client role, which is what makes the archive's precondition
  unbypassable — so `npm run probe:live-grants` gained a row on `chores.missed_at`'s reasoning,
  reading **18 of 19** before and
  **19 of 19** after. And what neither can see — the bodies, the
  archive's `for update` on the run row, the ACLs and the comments — a read-only catalog query over
  the Management API carries, taken on both sides in the same session:
  **before** (*measured*), PostgreSQL 17.6, no `archived_at` column on
  `shopping_lists` and no grant for it, no function named `archive_shopping_list` or
  `unarchive_shopping_list`, `add_shopping_item`'s body md5 `078c3b833c31e8f35f736ab8142bc250` and
  `finish_shopping_run`'s `f8407233ccd48d4e3a3677b610bd13a2` with neither mentioning `archived_at`,
  `finish_shopping_run`'s comment naming #354 only, and six functions matching `%shopping%`;
  **after**, one nullable `timestamptz` column carrying #360's comment, `authenticated` holding
  **SELECT and only SELECT** on it, both new functions present at `list uuid` with `secdef=true`,
  `search_path=""`, executable by `authenticated` and not by `anon`, the two replaced bodies moved to
  `6a61b75969bf18dc680019ded154cc42` and `4fb0ec0bbc8e0b1919a9efa3796a6fc3` and both now mentioning
  `archived_at`, `finish_shopping_run`'s comment gaining "Refuses an archived list (#360)", and eight
  functions matching `%shopping%`.

  **The controls held on both sides**, and the first is the one the design rests on: the columns
  `authenticated` may UPDATE on `shopping_lists` read `name` before and `name` after — so the client
  still cannot write the stamp, and the archive's precondition cannot be bypassed by a direct
  `update`. Policies on `shopping_lists` stayed at 2, `shopping_items` held no table-level privilege
  for `authenticated` or `anon` on either side (`0034`'s revoke, intact), and the table comment is
  unchanged.

  **`0035` was applied TWICE in this session, and the second apply is the one that counts.** The
  readings above are the first. A review fan-out then found that the first draft's
  `archive_shopping_list` took its lock through the MUTABLE predicate `closed_at is null … for update
  of r`: a `finish_shopping_run` committing during the lock wait retires the matched row, READ
  COMMITTED's recheck drops it, the successor run is outside the archive statement's snapshot, so
  `found` is false, **the emptiness check is skipped whole**, and the list is archived holding the
  items the finish carried forward — falsifying this entry's own "empty by the archive precondition",
  which is the stated reason the other three item writers carry no archive check. The fix moves the
  lock to the row whose identity cannot change: `for update` on `shopping_lists`, with
  `add_shopping_item` and `finish_shopping_run` taking `for key share` on the same row before their
  run lock, so the order is **list → run → item**.

  Re-applied at md5 `715b22131f51be676cdbc818cdb04bee` (26208 characters, 15 statements), read back
  identical. Only the three function bodies moved: `add_shopping_item` from
  `6a61b75969bf18dc680019ded154cc42` to `6c44e92e3005db85fb357e644205e17f`, `finish_shopping_run`
  from `4fb0ec0bbc8e0b1919a9efa3796a6fc3` to `c3515cea2026f1d969bd090a5fe6095c`, and
  `archive_shopping_list` rewritten; the column, its comment, its grant, the two function ACLs and
  every control above read identically on both applies.

  **The lock order is verified on the live bodies rather than inferred from a moved hash** — a
  changed md5 says a replace landed and nothing about what landed. *Measured* by
  `pg_get_functiondef` through the Management API immediately after the second apply:
  `archive_shopping_list` carries `for update;` on the list and **no run lock of either mode**, and
  reaches the items by joining `shopping_runs` through the list; `add_shopping_item` carries
  `for key share;` at offset 1524, `for key share of r;` at 1842 and its `archived_at` read at 2263;
  `finish_shopping_run` carries them at 1380, `for update of r;` at 1874 and its read at 2370 — so
  **list before run before stamp in both**. `purchase_shopping_item`, `unpurchase_shopping_item` and
  `remove_shopping_item` carry the run's key share and no list lock, which is the intended
  asymmetry; `unarchive_shopping_list` carries none at all.

  Re-runnable by construction, which is what made a second apply safe rather than alarming — the
  same shape `0034` records, and for the same reason: the first apply is what surfaced the defect.
  **`0033` on 2026-09-05 (#354, `finish_shopping_run`)**, applied with `npm run migrate:live` in
  the story's own session, before the merge and the `release` promotion — `0020`'s safe order —
  at md5 `70af1c0af2dc5fbec17f927dcee9452b` (19651 characters, 10 statements),
  read back identical. One NEW `security definer` function with `search_path` emptied, executable
  by `authenticated` and not by `anon`, plus `0032`'s three item writers REPLACED at their exact
  signatures to take a key-share lock on the run row before they touch an item (the `0033` entry
  below says why), and NO table, column, policy or grant change — the file touches nothing a
  client can reach directly, and `create or replace` keeps the ACLs `0032` set on the three.
  **`check:live` is NOT blind to this one**: a new
  function with a new argument set is exactly the row it probes, so the denominator moved from 44
  to **45** and the row was red on purpose until the apply — *measured **43 of 45** immediately
  before* (`PGRST202` on `finish_shopping_run(run_id)`, the other red the standing
  `extract-description` row) and *measured **44 of 45** immediately after*.
  `npm run probe:live-grants` has no row for it and needs none. What neither can see — the body,
  the row lock, the ACL and the comment — a read-only catalog query over the Management API
  carries, taken on both sides in the same session: **before** (*measured*), PostgreSQL 17.6, no
  function named `finish_shopping_run`, `purchase_shopping_item`'s body carrying no
  `for key share`, `shopping_runs_one_open_per_list` reading `UNIQUE … WHERE (closed_at IS NULL)`,
  and `authenticated`'s grants on `shopping_runs` reading SELECT on six columns and nothing at
  table level; **after**, one function `finish_shopping_run(run_id uuid)`, `secdef=true`, `search_path=""`, executable by `authenticated` and not by `anon`, its body carrying `for update of r` and `carried_from_item_id`, its comment naming #354; `purchase_shopping_item`'s body md5 moved from `b1d51c58…` to `2f128078…` with its signature `item uuid`, its ACL and its comment prefix unchanged — the replaced body, which is the only way the catalog shows a `create or replace` landed; the index and `authenticated`'s grants on `shopping_runs` byte-identical to the before-reading, which is the "no grant moves" half measured rather than claimed; and the project still holding 0 open runs, 0 closed runs and 0 carried items, so nothing existing was touched.
  **`0032` on 2026-09-05 (#352, the shopping schema with stamped RPCs)**, applied with
  `npm run migrate:live` in the story's own session, before the merge and the `release`
  promotion — `0020`'s safe order — at md5 `0ee0b917e6a5a3d8ab6e50b7370068bc` (28001 characters, 48 statements), read back identical. Three tables (`shopping_lists`,
  `shopping_runs`, `shopping_items`), row-level security on each with every policy keyed on
  `current_household_ids()`, four `security definer` RPCs (`create_shopping_list`,
  `add_shopping_item`, `purchase_shopping_item`, `unpurchase_shopping_item`) executable by
  `authenticated` and not by `anon`, and the grants the entry below records. **`check:live` is NOT
  blind to this one** — it moved the denominator from 37 to **44** (three table probes and four RPC
  probes) and every one of the seven was red on purpose until the apply: *measured **36 of 44**
  immediately before*, the three tables answering `PGRST205` and the four functions `PGRST202`, the
  eighth red the standing `extract-description` row — and *measured **43 of 44** immediately after*, the one red the `extract-description` row.
  `npm run probe:live-grants` gained three rows, one per table on `household_id` (`r` alone — the
  `0014` route on the read side, and the absence of `a` and `w` on the write side, which is the
  half `check:live` cannot see), and three table-level control rows (`shopping_items`
  `authenticated=d`, the other two no table-level grant at all): *measured **15 of 18** before*,
  the three new rows reporting `the column is not there`, and *measured **18 of 18** after, negative control included*, the three table-level controls reading `shopping_items authenticated=d` and no table-level grant on the other two. What
  testifies beyond both is a read-only catalog query over the Management API taken on both sides in
  the same session: **before**, `version()` read PostgreSQL 17.6 and no relation, function, policy
  or constraint named `shopping` existed; **after**, 32 rows — the three tables `rls=true`; the four functions at `household uuid, name text`, `run uuid, name text, note text`, `item uuid` and `item uuid`, each executable by `authenticated` and not by `anon`; the five policies with `current_household_ids` in every predicate and the delete policy carrying `purchased_at IS NULL` and `r.closed_at IS NULL`; both unique indexes, the run one `WHERE (closed_at IS NULL)`; every attribution FK reading `ON DELETE SET NULL (<column>)` and the two whole-stamp checks one-directional. The version
  reading is load-bearing rather than decorative: the attribution foreign keys use the column-list
  form `on delete set null (added_by_member_id)`, which is Postgres 15+, and the whole reason it is
  there is recorded in the migration's header and the entry below.
  **`0031` on 2026-09-05 (#97, a confirmed calendar suggestion is a capacity source)**, applied
  with `npm run migrate:live` in the story's own session, before the merge and the `release`
  promotion — `0020`'s safe order — at md5 `76868d316606f673c8c116cdd91f8cf5` (4415 characters,
  3 statements), read back identical. One constraint dropped and re-added to admit a third
  `member_capacity.source` value (`calendar`, beside `manual` and `extraction`), and one
  `comment on column`. **It issues no privilege statement** and touches no column, policy or
  function: `source` is already in every column list `0005` grants, and the client has written it
  since #210. So `check:live` is structurally blind to it in BOTH directions, `0029`'s shape
  without the function bodies — *measured at **36 of 37** immediately before AND immediately
  after the apply, the one red the `extract-description` row this bullet already carries* — and
  `npm run probe:live-grants` has no row for it and needs none. What testifies is the read-only
  catalog query `0029` used, over the Management API, taken on both sides in the same session:
  **before**, `member_capacity_source_known` admitted `'manual'` and `'extraction'` only and the
  column carried no comment; **after**, the constraint admits `'calendar'` too and the comment
  names #97 — with `authenticated`'s INSERT and UPDATE on `source` reading `true` on both sides,
  which is the no-privilege-statement claim measured rather than believed. A phone on a
  pre-`0031` project that tapped *Use this* and saved would have been refused by the constraint,
  loudly and by name, with the typed path untouched; that window did not open, because the apply
  landed before the merge.

  **`0029` on 2026-09-02 (#307, completing an unassigned chore assigns it to the completer)**,
  applied with `npm run migrate:live` in the story's own session, before the merge and the `release`
  promotion — `0020`'s safe order — at md5 `4215ca88a9d3e70b3656b4beb6874454` (12456 characters,
  5 statements), read back identical. One constraint dropped and re-added to admit a third
  `assigned_source` value (`completed`), one `comment on column`, and two `create or replace`s with
  UNCHANGED signatures (`complete_chore`, `uncomplete_chore`), so no overload and PostgREST's
  argument-name resolution is untouched. **It issues no privilege statement at all**, which is the
  claim most worth checking rather than believing: `create or replace` preserves a function's ACLs,
  and if it did not, the client would silently lose the ability to complete anything.
  It never entered the excused-red set and could not have — `check:live` probes tables, columns and
  RPC name/argument sets, and this file adds no column and changes no signature, so it is
  structurally blind to it in BOTH directions, the same shape as `0028` and for a different reason
  (a body there, a constraint and two bodies here). *Measured at **32 of 32** immediately before AND
  immediately after the apply, denominator unmoved*, and `npm run probe:live-grants` reads **15 of
  15 with its negative control** on both sides, which is what makes the no-privilege-statement claim
  a measurement. What testifies is a read-only catalog query over the Management API, taken on both
  sides in the same session: **before**, `chores_assigned_source_known` admitted `'manual'` and
  `'auto'` only, NEITHER function's body mentioned `assigned_source`, and the column carried no
  comment; **after**, the constraint admits `'completed'` too, both bodies mention it, the comment is
  present, and `complete_chore` still reads `chore_id uuid` and is still executable by
  `authenticated` and not by `anon`. The client is unchanged by this story — `assigned_source` was
  already in the column list it selects — so a pre-`0029` project simply credits nobody for an
  unassigned completion and a post-`0029` project credits the completer, with nothing for a phone to
  notice at the wire.

  **`0028` on 2026-09-02 (#306, a missed occurrence does not stack up)**, applied with
  `npm run migrate:live` in the story's own session, before the merge and the `release` promotion —
  `0020`'s safe order — **and applied TWICE, the second being the one that stands**: first at md5
  `050dbfdd61fb82f048df4d95adf2ce01` (15472 characters, 2 statements), then, after the story's review
  fan-out added the `missed_at` column-comment restatement and the anchor-cost paragraph, at md5
  `b09c21bce3940f315964f3b2b8216bd3` (17471 characters, 3 statements), both read back identical.
  `0028` is idempotent by construction and had reached no project but this one, so the amended file
  was re-applied rather than chased with a `0029` — `0026`'s precedent from two days earlier — and
  both digests are kept because a recorded md5 whose file has moved is worse than none. One `create
  or replace` of `catch_up_repeats_at` with the same signature and the same return type (so no
  overload, and the ACLs `0012` set on it survive), plus two `comment on`s (the function's, and the
  column's, whose live text now names the pass as a writer — *read back from `col_description` after
  the second apply*): when the pass creates a new occurrence for an anchor, every outstanding member of
  that anchor's family with an older `due_on` is marked missed with the pass's own clock — the
  anchor row included, completed rows untouched, an already-missed row keeping its first stamp, a
  put-back row surviving until the next occurrence really generates. It never entered the
  excused-red set and could not have: `check:live` is structurally blind to it in BOTH directions —
  it probes a function by name and argument set, and this file changes neither — *measured at 32 of
  32 immediately before AND immediately after the apply, denominator unmoved*. `npm run
  probe:live-grants` is blind to it for the same reason and reads **15 of 15** on both sides. What
  testifies is a read-only `pg_get_functiondef` over the Management API (the same route
  `probe:live-grants` uses), taken on both sides in the same session: the supersede step
  (`set missed_at = as_of`) **absent** from the live body before the apply and **present** after
  it, the function's comment naming #306 only afterwards, and the privileges unchanged across it —
  the held form executable by neither `authenticated` nor `anon`, the client surface by
  `authenticated`. The two directions coexist: the client is unchanged by this story (it reads
  `missed_at` since `0027` and calls the same `catch_up_repeats()`), so a pre-`0028` project simply
  goes on stacking and a post-`0028` project stops, with nothing for a phone to notice either way.
  The hazard this file inherits from `0025` and `0026` is stated in its header and **measured, three
  arms, in `superseded.pglite.test.js`** (the first draft of this entry said *measured* while no such
  arm existed — the review fan-out caught the inference wearing the label, and the arms were added
  rather than the word removed): re-pasting `0012`, `0025` or `0026` on top of it **succeeds
  silently, leaves one function, and reverts the step**, and `check:live` cannot see that either —
  the repair is re-pasting `0028`. The file also restates `missed_at`'s column comment, because
  `0027`'s said *"Set only by miss_chore"* and the pass is now a writer; the catalog carries `0027`'s
  sentence until `0028` is applied, which is the same one-clause repair `0026` made for `repeat_kind`.
  **`0027` on 2026-09-01 (#305, a chore that did not get done)**, applied with `npm run migrate:live`
  (md5 `6ba7d36d46c23af1791a7061e0a72725` read back identical, 11090 characters, 11 statements) in
  the story's own session, before the merge and the `release` promotion — `0020`'s safe order. One
  nullable column, `chores.missed_at`, set only by two new definer functions (`miss_chore`,
  `unmiss_chore`) from the database clock *(true when written; since `0028` on 2026-09-02 the
  catch-up pass is a third writer — see the entry above — and the privilege claim is unchanged, since
  that pass is granted to no client role either)*, `complete_chore` replaced with the same signature so
  that Done clears the miss, and a CHECK forbidding both stamps at once. `check:live` sees THREE
  parts of it and both sides were measured: **29 of 32 before the apply** — `chores` answering
  `42703` on `chores.missed_at`, and `miss_chore` / `unmiss_chore` both `PGRST202` — and **32 of
  32 immediately after**, all three clearing on exactly that action. The denominator moved from 30
  to 32 because the story added the two RPC probes. What `check:live` cannot see — that the column
  is granted `select` and NOTHING else to `authenticated` — is `npm run probe:live-grants`'s
  fifteenth row, `chores.missed_at=r` (*measured 2026-09-01 at **15 of 15 agreeing**, the
  `chores.repeat_since` negative control still carrying no column-level grant*); the withholding is
  the absence of a grant rather than a revoke, and `missed.pglite.test.js` pins it by mutation. The
  two directions coexist: a pre-`0027` client selects no `missed_at` and calls neither function, and
  the column defaults null, so nothing it does changes; a post-`0027` client against a pre-`0027`
  project fails loudly on the chores read, which is the window `check:live` exists to keep visible
  and which the in-session apply closed within the hour.
  **`0026` on 2026-08-31 (#103, monthly repeats)**, applied with `npm run migrate:live` (md5
  `3897797d46d358a2c86d79fa85bea600` read back identical, 16949 characters, 12 statements) in the
  story's own session. **Applied TWICE that day, and the second is the one recorded above**: the
  first apply carried md5 `70e3ba954d79883965f0fbe8728af1dd` (13276 characters), and the story's
  review then changed the file — the catch-up bound became kind-dependent, on an owner decision at
  the commit gate. `0026` is idempotent by construction and had reached no project but this one, so
  the amended file was re-applied rather than chased with a `0027` whose only content would have
  been one replaced function. Both numbers are kept because a recorded md5 whose file has moved is
  worse than none: a reader checking the live project against this page needs to know which paste
  it is looking at. `check:live` sees exactly HALF of it: `repeat_monthday` joins
  `CHORE_COLUMNS`, and both sides were measured — **29 of 30 before the apply**, the one red
  `chores` answering `42703 column chores.repeat_monthday does not exist`, and **30 of 30
  immediately after**, clearing on exactly that action. What it cannot see — the INSERT and UPDATE
  halves of the new column's privileges, the widened kind constraint, and the replaced schedule
  function — is covered two ways: `npm run probe:live-grants` gained a `chores.repeat_monthday=arw`
  row (*measured 2026-08-31 at **14 of 14 agreeing**, the `chores.repeat_since` negative control
  still carrying no column-level grant*), and the constraint plus clamp behaviour are proven against
  a real Postgres by `repeats.pglite.test.js`. The apply came BEFORE the merge and the `release`
  promotion, `0020`'s safe order. The two directions coexist **for reads and for creates** — a
  pre-`0026` client names no monthday anywhere, the column defaults null, the widened constraint
  admits every old shape, and the replaced pass behaves identically for daily and weekly — while a
  post-`0026` client against a pre-`0026` project fails loudly on the read, which is the window
  `check:live` exists to keep visible and which the in-session apply closed within the hour.
  **One edit path is the exception, and this sentence claimed otherwise until it was measured**
  (#103's review, corrected the same day): a pre-`0026` client editing a MONTHLY chore's schedule
  sends the kind/weekdays pair without `repeat_monthday`, leaving the old value standing, so
  `chores_repeat_monthday_shape` refuses. *Measured against a real Postgres*: switch-off,
  monthly→weekly and monthly→daily all refused, **3 of 3**, with the post-`0026` spelling of the
  identical edit succeeding as the control — so it is the missing column, not the row, the role or
  a policy. Bounded on both sides by the same run: a **title-only** edit on a monthly chore
  succeeds, so the blast radius is schedule edits alone, and every **non-monthly** row is
  unaffected, which is every row that exists today. It fails closed and the old build's edit form
  swallows the rejection silently, and reaching it at all needs a monthly chore created by a
  post-`0026` client and then edited from a device on a stale build — Taskr #260's service-worker
  case. Recorded rather than repaired: the repair would be a trigger nulling `repeat_monthday`
  whenever the kind is not monthly, mirroring what `0012` already does for `repeat_since` on the
  same trigger, and it is not #103's to take unasked.
  **`0025` on 2026-08-31 (#105, skipping a single occurrence)**, applied with `npm run migrate:live`
  (md5 `503e51d11da186853141bb9da38c093d` read back identical, 17592 characters, 12 statements) in
  the story's own session. `check:live` is NOT blind to this one — the same change gave it a table
  entry (`chore_repeat_exceptions`) and an RPC probe (`skip_repeat_occurrence`), and BOTH sides were
  measured: **28 of 30 before the apply**, the two new entries the two reds (`PGRST205` and
  `PGRST202`), and **30 of 30 immediately after**, clearing on exactly that action. The one half the
  RPC probe cannot see is the EXECUTE privilege: `skip_date` is a `date`, so the nil-UUID
  placeholder fails its cast (`22P02`) before the privilege check — `apply_assignments`' documented
  limit, tracked as #268 — and the privilege is proven against a real Postgres by
  `repeats.pglite.test.js` instead (an `anon` arm included, so the by-name revoke is exercised, not
  assumed). `npm run probe:live-grants` gained a table-ACL control row in the same change —
  `chore_repeat_exceptions` expects NO table-level grant for `authenticated`, which is the
  single-writer model made visible in the catalog, since the client holds column-level select and
  nothing else and `skip_repeat_occurrence` (definer) is the only writer: *measured 2026-08-31 at
  **13 of 13 agreeing**, negative control included*. The apply came BEFORE the merge and the
  `release` promotion, `0020`'s safe order, and the two directions coexist: a pre-`0025` client
  never calls the new function, and the replaced catch-up pass behaves identically while the
  exception table is empty.
  **`0024` on 2026-08-31 (#54, editing or stopping a repeat)**, applied with `npm run migrate:live`
  (md5 `7f1795a1f7ed2c0dd5612a0793bd0383` read back identical, 4757 characters, 1 statement) in the
  story's own session. It never entered the excused-red set and could not have: `check:live` is
  structurally blind to it in BOTH directions — one UPDATE grant, a privilege that check only ever
  exercises by reading — *measured at 28 of 28 immediately after the apply, denominator unmoved*.
  What testifies instead is `npm run probe:live-grants`, which gained two expectation rows in the
  same change (`chores.repeat_kind` and `chores.repeat_weekdays`, both `arw`): *measured 2026-08-31
  at **13 of 13 agreeing**, negative control included* — `chores.repeat_since` still carries **no
  column-level grant**, which is the row that proves `0024` widened exactly the pair and nothing
  else. The apply came BEFORE the `release` promotion, `0020`'s safe order; the client additionally
  sends the repeat pair only when a schedule actually changed, so a pre-`0024` client and a
  post-`0024` project can coexist in either order for every edit that is not a schedule edit.
  **`0023` on 2026-08-28 (#211)**, applied with `npm run migrate:live` (md5
  `3f1df4ec58d79025b12f7f612ff759e4` read back identical, 8982 characters, 5 statements) in the
  story's own session. This is the first migration here whose before-reading AND after-reading were
  both taken, which is the gap `0022`'s entry below records rather than papers over: *measured at
  **27 of 28** with `chores` answering `42703` — `column chores.source does not exist` — and at
  **28 of 28** immediately after*. The denominator did not move, because `0023` widens the existing
  `chores` column list rather than adding an entry; the row it would have held never became an
  excused red, because the apply landed in the same session as the code that reads the column.
  `npm run probe:live-grants` has NO row for `chores.source` and needs none — unlike `0013`, `0019`
  and `0022`, this check is not blind to `0023`: the SELECT grant is exactly what made the red
  above, so the instrument that would excuse it is the instrument that caught it. **The one half no
  live instrument covers is the INSERT grant**, since `check:live` only reads; that is proven
  against a real Postgres by `src/test/chores.pglite.test.js` and is stated here as a known gap
  rather than left to be inferred from an empty excused-red set.
  **`0022` on 2026-08-28**, applied with `npm run migrate:live` (md5
  `13ce80f76fe0b15d5cbeb85b4e2a7a06` read back identical) in the session that found the defect.
  It is the FOURTH migration this check cannot speak for, and the reason is the same shape as
  `0013`'s: `0022` is made of column grants and one trigger, and `check:live` reads tables,
  columns, RPCs and functions. The blindness is verified rather than assumed — `0022` creates no
  table, adds no column, and its one function (`member_capacity_identity_is_fixed`) is named
  nowhere in `src/lib/liveSchema.js`, `LIVE_RPCS` included. It read **28 of 28 after** the paste;
  the before-reading was NOT taken, so that half is reasoned from the two artefacts and not
  measured, which is why it is said here rather than left to be inferred. What testifies
  instead is `npm run probe:live-grants`, which gained four expectation rows in the same change
  (`member_split_seen.member_id`, and `member_capacity`'s `household_id`, `member_id` and
  `period_start`, all `arw`): they read **MOVED before the apply and ok after**, 10 of 10 agreeing
  with the negative control included. Unlike `0013`, whose paste production genuinely could not
  testify to because it was a no-op there, `0022` changed real state and the catalog says so.
  The reading before #250's two rows was *measured 2026-08-28 at 26 of 26*, by running the instrument
  after `0021` was applied in #59's own
  session with `npm run migrate:live` (md5 `addd7e14b36383cee3b9282f36f9bcb4` read back identical).
  `0021` widened an existing entry rather than adding one — the `member_split_seen` column list grew
  by the fairness note's dismissal flag — so the denominator did NOT move, and the entry would have
  answered `42703` on the new column until the apply; it never stood as an excused red because the
  apply landed in the same session, before the merge. The reading before that: *measured 2026-08-28
  at 26 of 26* after `0020` was applied in #50's own session the same way
  (md5 `180b5beb64655324e55a4eecad9d15fa` read back identical).
  Before that application the same session measured **25 of 26** — every `0001`–`0019` subject
  green, `member_split_seen` answering `PGRST205`, the new entry doing its job — so the excused row
  stood for under an hour and drained on exactly the action it named. `npm run probe:live-grants`
  agrees from the catalog side: `member_split_seen` carries **no table-level grant** for
  `authenticated`, which is `0020`'s revoke visible where `check:live` cannot see it. The reading
  before #50 widened the instrument: *measured 2026-08-27 at 25 of 25*, by running it after `0019`
  was applied under #235.
  `0019` never entered the set, because this check is blind to it in both directions (see
  its bullet below); it is confirmed instead by `npm run probe:live-grants`, which reads **zero
  moved control rows** where it read exactly three before the paste.
  `0017` never entered the set because this check is blind to it (see its bullet below); it is
  confirmed instead by `npm run probe:live-grants`, which reads **anon holds no table-level or
  column-level privilege in `public` and may execute no function there** — 6 of 6 agreeing, negative
  control included. Before those two, the set was EMPTY as well — *measured
  2026-08-26 at 24 of 24, re-measured 2026-08-27 at 24 of 24 across the `0016`
  paste, which could not have moved it*. `0001`–`0008`
  as of 2026-08-20 (#108),
  `0009` on 2026-08-21, `0010`–`0012` on 2026-08-24, **`0013` and `0014` on 2026-08-26 (#150)**,
  **`0015` on 2026-08-26 (#194)**, **`0016` on 2026-08-27 (#198)**, **`0017` and `0018` on
  2026-08-27**, and **`0019` on 2026-08-27 (#235)** — `0018` applied under #231 with
  `npm run migrate:live`, `0019` the same way under #235, and `0017` confirmed already
  applied by the grant catalog in the same pass rather than by a paste anybody recorded, and
  **`0021` on 2026-08-28 (#59)**, applied with `npm run migrate:live` in the story's own session.
  `0013` (the inherited grants, #91) and `0016` (the organizer-only removal rule, #152) never
  appeared in the expected-red set below, because
  `check:live` is structurally blind to both — and each paste was **verified anyway**, by an
  instrument that check does not have. See the *three* migrations that bullet cannot speak for,
  which since
  2026-08-26 is a statement about `check:live` rather than about what is knowable. `0007` and `0008`
  were pasted together, which is what emptied the expected-red set the first time. `0002` is verified
  over the wire by the live RLS suite (PR #65, 13/13 against the real project); `0007`, `0008`,
  `0010` and `0011` are verified by `npm run check:live` — every table, every RPC, and (since #115)
  both Edge Functions; the rest are verified only by the paste succeeding. The denominator moved
  from 20 to 21 on 2026-08-21 when #37 added `chore_exclusions` to `LIVE_SCHEMA`, to 23 on
  2026-08-24 when #95 added `calendar_connections` and the `calendar-connect` Edge Function, to
  **24** the same day when #53 added the `catch_up_repeats` RPC, and to **25** on 2026-08-27 when
  #49 added the `apply_assignments` RPC, and to **26** when #50 added `member_split_seen` — the
  per-member seen-marker behind the re-balance announcement, SELF-scoped rather than
  household-scoped (a phone must not be able to mark another member's announcement as seen), with
  select/insert/update granted by column in `0020` — plus `0021`'s fairness-note dismissal flag
  (#59), select and update only — and nothing granted to `anon` or
  `service_role`. `0013` does not move it, and that
  is the point of the bullet above rather than an oversight.

  *This Status line said `0012` had NOT been pasted until 2026-08-24, while the expected-red bullet
  twelve lines below had recorded it pasted and measured at 24 of 24 since the same evening. PR #139
  corrected the bullet and stopped there — the edit was framed as fixing the paragraph about the
  paste, not as correcting a fact that this page states in two places. Found and fixed by #91, which
  had to edit this header for an unrelated reason. Noted rather than quietly repaired, because the
  next reader's question is which of the two copies was wrong, and it was this one.*
- **`0009` landed on 2026-08-21 and `0010` and `0011` on 2026-08-24, and all three are verified over
  the wire — but not by the same instrument, and that is the thing to carry.** `0011` went in first
  of its pair, out of file order and ahead of its own PR merging, which is allowed and is worth
  noting rather than tidying away. Nothing in `0011` depends on `0009` or `0010`; it references
  `households` and `members`, both of which predate all three.
  - **`0009`** (#127) — the two indexes that made membership per-database rather than per-household.
    **Pasted 2026-08-21, confirmed by `npm run test:rls`** and by nothing else, because `check:live`
    cannot see an index: see the blindness bullet below. That suite cannot reach its first assertion
    unless `0009` is applied — `beforeAll` puts one seeded account in two households, which the
    pre-`0009` global `members_claimed_by_key` forbids, and that is exactly how #127 was found.
    *Re-measured 2026-08-24: 31 of 31, no skips. Re-measured again 2026-08-28: **57 of 57**, no
    skips, after #221 restored the seeded account — and **65 of 65** later the same day, once #38
    added eight chore cases to it. The count moved because tests were added; none were removed.*
    **A suite that fails at setup under the old schema
    is a stronger presence check than any probe**, because it cannot pass for the wrong reason.
    The 2026-08-28 re-measurement matters for a reason beyond the number: this confirmation had
    **lapsed without saying so**. The seeded account was cleared around 2026-08-25, so from then
    until #221 the sentence above was still true as history and the instrument behind it could not
    run — and because a `beforeAll` failure is reported by vitest as tests SKIPPED, the lapse
    presented as an environment hiccup rather than as a dead suite. **The one confirming instrument
    for this whole class of migration can stop working without any artefact changing**, so its
    liveness is worth checking on the same occasions its verdict is relied on.
  - **`0010`** (#37) — the exclusions table and the two eligibility functions. **Pasted 2026-08-24,
    verified over the wire**: `chore_exclusions` answers with exactly its four granted columns, and
    that assertion had been red by design from the merge until the paste.
  - **`0011`** (#95) — `calendar_connections`, which the client reads, and `calendar_tokens`, which
    it is granted nothing on. **Pasted 2026-08-24, verified over the wire.** **The first credential
    this schema holds that belongs to somebody else**: a Google refresh token is a bearer credential
    for a person's calendar and does not expire on its own. It is a separate table rather than a
    withheld column on purpose — a column grant is a list somebody edits, and adding a column to the
    wrong `grant select (...)` line is a one-word diff that reads like the twenty others in these
    files and fails silently. The equivalent mistake here is a whole new grant statement, which is a
    thing a reader argues with.
  - **`0030`** (#96) — `calendar_busy`, the derived busy-minutes table the roster reads. **NOT
    applied at merge, and applied in #100's session on 2026-09-04** with `npm run migrate:live`
    (9 statements, md5 read back equal to the file's), the second migration on this page to need a
    DEPLOY as well as a paste: `calendar-busy` is an Edge Function, so `npm run deploy:function`
    was the other half, run in the same session (v1 of that function; `check:deployed` reads all
    three current). Two actions, two expected reds, and `0011`'s entry below was the worked
    example of what to expect — the paste cleared only its own, *measured*: `check:live` read 34
    of 36 before, with `calendar_busy` answering `PGRST205` and `calendar-busy` 404, and 36 of 36
    after. `npm run probe:live-grants` read 15 of 15 after the apply, `calendar_busy` carrying
    `service_role=arwdDxtm` and no `authenticated` table-level grant, and a client select of the six
    granted columns as the seeded account answered 200 while `select=household_id` and `select=*`
    both answered `42501`. The stored shape is the whole of this story's minimization
    decision (owner, 2026-08-16): `member_id`, `period_start`, `busy_minutes`, `event_count`,
    `computed_at` and nothing a calendar could have put there, enforced as an absent column rather
    than as a rule in the function. `service_role` is the only writer, exactly as for `0011`'s two
    tables, because the figure is derived from a credential no client can reach. Live confirmation
    of the grants is #100's — **not** because the local half is vacuous. *This entry said exactly
    that until the same day it was written*, copying `0011`'s comment, and the measurement in
    `0030`'s own privilege comment contradicts it: since #91 (the `0013` entry below) the harness
    default is `Dxtm` with no DML, so deleting `0030`'s `service_role` grant reddens
    `grants.pglite.test.js` — predicted 1, actual 1. What no local suite can say is whether the
    **live** project has had the migration applied at all, because the harness builds the schema
    it certifies; that is what #100 owns. The superseded sentence stood in `0011`'s comment and
    in `calendar.pglite.test.js` until #334 corrected both against measurements of their own
    (2026-09-05: `0011`'s revokes redden 3 of 23, its `service_role` grants 1 in
    `grants.pglite.test.js`).
  - **`0031`** (#97) — `member_capacity_source_known` admits `calendar`, so a figure a member
    took from their calendar's suggestion and confirmed unedited is stored with that word; an
    edited one is `manual` (the mirror of #210's rule for `extraction`, and the issue's own). No
    grant, no policy, no function — the row was already writable with a `source` since `0005`, and
    the only thing a pre-`0031` project does differently is refuse the third word by name. The
    pglite suite proves both directions (`calendarCapacity.pglite.test.js`: a database built
    through `0030` refuses a calendar row naming the constraint, one built through `0031` accepts
    it), which is what a widening test has to do — the accepted arm alone would be green against a
    constraint that never bit. Applied 2026-09-05 in #97's own session; the readings are in the
    Status bullet above, the one place this page records live state.
  - **`0032`** (#352) — the shopping schema: `shopping_lists`, `shopping_runs` and
    `shopping_items`, the first tables here with no fairness arithmetic behind them (charter,
    2026-09-05: a standalone household utility). Applied 2026-09-05 in #352's own session; the
    readings are in the Status bullet above. What this entry records is the ACCESS model, which
    is the half a check cannot carry:
    - **The stamp columns are withheld from every client write.** `added_by_member_id`,
      `added_at`, `purchased_at`, `purchased_by_member_id`, `closed_at` and
      `closed_by_member_id` carry no UPDATE grant for `authenticated` (the only UPDATE grant on
      the three tables is `shopping_lists(name)`), for `0004`'s clock reason and its who reason:
      a timestamp says WHEN and is written from `now()` inside a definer function, never accepted
      from a phone; a member id says WHO and is resolved by `acting_member()` from the caller,
      never named by them. `shopping.pglite.test.js` asserts the exact UPDATE column set and the
      behavioural refusal, and the AC 4 mutation — adding `grant update (purchased_at)` — reddened
      the three tests predicted.
    - **There is NO client INSERT grant on any of the three tables**, table-level or column-level,
      and the reason is structural rather than cautious: `create_shopping_list` opens the list's
      first run in the same transaction, so a direct insert would produce a runless list, a state
      the Shop tab cannot draw; `add_shopping_item` is the only way an item arrives before #354's
      rollover, because the stamps have to be written in the same statement as the row. Creation
      is the RPCs' alone, and the four are granted `execute` to `authenticated` with `public` and
      `anon` revoked, `0010`'s shape.
    - **`household_id` is granted for SELECT on all three** — the `0014` route, and the one
      grant that decides the read model: the Shop tab reads *this household's* lists by naming the
      household, then the open run of each list by list id, then the items by run id — three plain
      filters, never a filter through a PostgREST embed (cairn's
      `postgrest-filtering-on-an-embedded-resource`: an embed filter nulls the embed and keeps the
      parent, so the row count never moves). Every column of all three is readable, so
      `select('*')` succeeds on them as it does on `members` since `0014`; what survives is the
      per-column grant shape (no table-level SELECT), asserted in pglite.
    - **The delete policy's predicate** — the only client-side row delete in the feature (owner
      decision, 2026-09-05: any member may remove an unbought item from an open run):
      `household_id in (select public.current_household_ids()) and purchased_at is null and
      exists (select 1 from public.shopping_runs r where r.id = shopping_items.run_id and
      r.closed_at is null)`. A delete matching a bought item or an item on a closed run affects
      zero rows rather than raising, which is how row-level security refuses; pglite asserts the
      count both ways, and dropping the `purchased_at` clause reddened the two tests predicted.
    - **One correction taken in band, and it is a RECURRENCE of a rule this schema already
      carries three times.** The first draft wrote the attribution foreign keys as composite
      `(member_id, household_id) references members (id, household_id) on delete set null` —
      `0030`'s shape with the delete rule changed — and paired them with symmetric whole-stamp
      check constraints (`(closed_at is null) = (closed_by_member_id is null)`). *Measured in
      pglite before the file reached any project*: removing a member was REFUSED with `null value
      in column "household_id"`, because a composite FK's `set null` nulls **every** referencing
      column, the scoping column included. `0006` writes the column-list form `on delete set null
      (assigned_member_id)` and its comment says exactly this; `0012` and `0018` repeat it; cairn
      records it twice. The draft did not meet it because `0030` — the nearest migration that
      CREATES a table with a composite member FK — cascades, and the three files carrying the rule
      are column additions. The suite caught it, not the reading. The fix is that column list,
      `on delete set null (closed_by_member_id)`, and one-directional checks — a closer implies a
      close, a buyer implies a purchase, never the converse — so a removed member leaves the WHEN
      and loses the WHO, which is the charter's 2026-08-26 leave/close decision applied. The live
      project is PostgreSQL 17.6 (read before the apply); a mutation back to the bare `set null`
      reddens the member-delete test, predicted 1.
  - **`0036`** (#208) — `extraction_calls`: the extraction endpoint's call ledger, one row per
    provider call, written as `service_role` by `supabase/functions/extract-description` BEFORE
    the provider is asked and counted over a rolling window to refuse a household past the bound
    (`RATE_LIMIT` in that function's `handler.ts`, the one place the constant is written). Applied
    2026-09-07 in #208's own session; *measured* `check:live`
    **47 of 48** immediately before and
    **47 of 48** immediately after — the same figure on both sides BY
    CONSTRUCTION, because no client reads this table and the check has no row for it, the one red
    on both sides being the excused `extract-description`, which #209 then drained on 2026-09-07; and
    `probe:live-grants` **19 of 19 column rows, with the `extraction_calls` table control row MOVED** immediately before, the new
    `extraction_calls` control row reading *not there*, and **19 of 19, every table control row agreeing**
    immediately after. What this entry records is the access model:
    - **No client can NAME it.** `0011`'s device for `calendar_tokens`, and for `0011`'s reason:
      nothing here is shown on a screen, so the table gets no column list a client may read part
      of — `revoke all … from authenticated, anon, public`, row-level security ON with no policy
      at all, and `service_role` granted SELECT and INSERT and nothing more, the two verbs the
      function uses. A grant added by accident later still reaches no row; two independent
      mistakes would be needed rather than one. `src/test/extraction-calls.pglite.test.js` asserts
      each half, and `grants.pglite.test.js`'s audit of every `service_role` table carries the
      first two-letter row.
    - **Why a table, and not a counter in the function's memory.** An isolate's `Map` is one
      count PER ISOLATE, reset on every cold start — and #205 measured cold starts between one tap
      and the next — so a bound held that way is green in every test this repo can write and
      holds nothing a bill would notice. Owner decision at #208's pickup, 2026-09-07: the count is
      durable, so the bound is one bound. The row is written before the call rather than after,
      so an attempt the provider refuses or times out on still spent the window.
    - **The composite foreign key is `0010`'s**: `(member_id, household_id)` references
      `members (id, household_id)`, so a row pairing one family's person with another family's id
      cannot exist. `on delete cascade` means a removed member takes their rows with them, which
      loosens that household's bound by however many calls they made this hour and nothing else.
    - **Which instrument sees which half.** `check:live` sees NONE of this file and never will —
      it probes what the client asks for. `probe:live-grants` is the instrument for the grant
      half: its control list gained an `extraction_calls: null` row, `calendar_tokens`' shape,
      red as *not there* until the apply. The deploy of the function that writes here was #209's,
      on 2026-09-07, and its row is the drained excused red above — so this table had a working
      writer only from that date, a day after the table itself existed.
  - **`0035`** (#360) — `shopping_lists.archived_at`, `archive_shopping_list(list)` and
    `unarchive_shopping_list(list)`: put a list away so the picker stops drawing it, and bring it
    back, without deleting a row. Applied 2026-09-06 in #360's own session;
    *measured* **44 of 48** on `check:live` immediately before and
    **47 of 48** immediately after, the one remaining red being the
    excused `extract-description`; and `probe:live-grants`
    **19 of 19**, negative control included. What this entry
    records is the access model:
    - **The stamp is read by the client and written by nobody but the two RPCs.** `archived_at`
      joins the SELECT grant `0032` set per column, and joins no UPDATE grant — the client still
      holds `update (name)` on `shopping_lists` and nothing else. That is not a convenience: the
      archive is refused while the list's open run holds any item, and that check is a read
      followed by a write, so it is only sound taken under a lock. A client `update` could take
      none. `probe:live-grants` is the only instrument that can see the absence, on
      `chores.missed_at`'s reasoning — a check that only ever reads cannot report being allowed a
      write it never attempts.
    - **The archive takes the RUN row `for update`, and that is the schema's existing lock order.**
      `0033` gave the three item writers `for key share` on the run row before they touch an item,
      and `0034` gave the fourth the same; `for update` conflicts with all of them, so an add
      arriving while an archive is in flight waits and is then refused by the stamp, and an archive
      arriving while an add is in flight waits and then counts the item it added. Nothing new is
      lockable: the list row is deliberately NOT locked, because the state being protected — "the
      open run is empty" — lives on the run.
    - **Two writers can reach an archived list and both are replaced here**, at their exact
      signatures so neither becomes an overload (`PGRST203`): `add_shopping_item`, which would
      otherwise put an item on a list nobody can see, and `finish_shopping_run`, which would
      otherwise CLOSE an archived list's empty run and OPEN a fresh one. The other three item
      writers are untouched, and the reason is structural rather than an omission — an archived
      list's open run is empty by the archive's own precondition, so a purchase, an un-purchase and
      a remove have no item to name.
    - **The refusal is stricter than the story's AC said, and the owner chose it at pickup**
      (2026-09-06). AC 1 said "unbought items"; the story's own rationale called an archived list's
      open run "empty". Under the looser rule a list whose open run held only BOUGHT items could be
      archived, and those rows would be reachable from nowhere — an open run is not history
      (`readClosedRuns` is `closed_at is not null`) and an archived list draws its finished runs
      only. The stricter rule makes "there is nothing here to draw" a fact about the database.
    - **The re-paste hazard is two files deep and both directions are asserted.** Re-applying
      `0033` alone silently restores the pre-archive bodies of both replaced functions, so an
      archived list becomes writable with nothing erroring. Re-applying `0032` is worse in kind: it
      opens with `revoke all on public.shopping_lists from authenticated, anon` and re-grants four
      columns by name, so the client stops being able to READ the stamp — every list comes back
      looking active, the picker draws the ones the household put away, and nothing refuses
      anything. The safe re-paste order is the whole sequence and now ends on `0035`;
      `archive-shopping-list.pglite.test.js` asserts both.
    - **An archived name stays taken.** The unique index is `(household_id, lower(name))` and
      `0035` does not exclude archived rows from it, so a new "Groceries" beside an archived one is
      refused with #358's own sentence. The better of the two failures: the alternative is a
      household holding two lists it cannot tell apart in a picker that shows the name and nothing
      else.
  - **`0034`** (#368) — `remove_shopping_item(item)`: delete an unbought item from an open run,
    holding the run row `for key share` FIRST, and the withdrawal of the client DELETE grant and
    the policy `0032` created for it. Applied 2026-09-06 in #368's own session;
*measured* **44 of 46** on `check:live` immediately before and
    **45 of 46** immediately after, the one remaining red being the excused `extract-description`;
    and `probe:live-grants` **18 of 18, negative control included, anon reaching nothing**. What
    this entry records is the access model:
    - **The client no longer writes `shopping_items` at all.** `0032` granted `delete` and wrote
      `shopping_items_delete_unbought_on_open_run` to bound it: household, `purchased_at is null`,
      and the item's run open. That policy is correct about WHICH ROWS and can say nothing about
      WHEN, because **a policy cannot take a lock**. `0033` gave the other three writers the run's
      `for key share` and could not give it to this one — the header of `0033` said so and filed
      it here. After `0034`: `authenticated` holds SELECT on every column of `shopping_items`,
      `UPDATE (name)` on `shopping_lists`, and no INSERT, UPDATE or DELETE anywhere in the
      feature; the four writers of the item table are four `security definer` functions with one
      lock order between them.
    - **The window it closes is a LOST RECORD, not a lost delete.** A finish holds an unbought item
      as a carry source; a remove of that item waits, the finish commits (run closed, copy made
      with `carried_from_item_id` set), and the delete then proceeds against the ORIGINAL under a
      predicate evaluated on its own older snapshot, where the run still read as open. The closed
      run loses its record of an item it held — `0032`'s "a closed run is the record", broken —
      and the copy survives with `carried_from_item_id` nulled by `on delete set null`, so it is
      indistinguishable from an item somebody typed. Nothing raises. Found by #354's review
      fan-out before `0033` reached any project, and unreachable by every instrument here: pglite
      is one connection and #356's live harness is finish-against-finish.
    - **It refuses by name** — `run already closed` and `item already bought`, the family's own
      sentences (owner decision, 2026-09-06, taken against preserving the DELETE's silence). The
      catalogue tests assert the clause and its ORDER for all four writers now, anchored on the
      statement's terminator so a body's own prose about the clause cannot satisfy them.
    - **The re-paste hazard is sharper than `0033`'s and is asserted.** Re-applying `0032` over
      the top restores the delete grant AND the policy, handing the client back the writer that
      cannot lock — and re-applying `0033` does not fix it, because `0033` never touched a grant.
      The safe re-paste order ends on `0034`.
    - **This file was applied TWICE, and the second apply is the record worth keeping.** Its first
      draft revoked `from public` where `0032` and `0033` both write `from public, anon`, and
      `probe:live-grants` read **anon still holding execute on `remove_shopping_item`** — a stray,
      on a project where `0017` exists precisely to keep anon at nothing. The obvious repair is a
      pglite assertion so the harness catches it next time, and it is **wrong**: putting the first
      draft back and running that assertion reddens NOTHING (*measured*, 0 of 1), because a bare
      `revoke … from public` removes the PUBLIC default and this harness's `anon` holds nothing
      else, while the live project's does. **The catalog probe is the only instrument for this
      class**, which is what it was built for, and the pglite assertion added here is a regression
      guard on the definer/search_path/authenticated shape and says so in its own comment.
    - **One control row in `probe:live-grants` moved, deliberately.** It recorded
      `shopping_items authenticated=d` — the one whole-row privilege the client held — and `0034`
      withdraws it, so the recorded expectation is now `null` in the same change. Left alone it
      would have made that probe red forever on a change somebody chose, which is how an
      instrument stops being read.
  - **`0033`** (#354) — `finish_shopping_run(run_id)`: close the named open run and open the
    list's next one with every unbought item copied forward, as ONE transaction under
    `select … for update`, returning the new run. Applied 2026-09-05 in #354's own session; the
    readings are in the Status bullet above. What this entry records is the access model:
    - **The argument is the RUN and never the list, and that is the whole safety of the thing.**
      Two phones showing the same open run, both pressing Done: with `list_id` the second call
      would resolve the list's open run AFRESH — the run the first call just opened — close it
      and carry every item forward twice. With `run_id` the second call names the run its screen
      showed, waits on the row lock, re-reads the close the first call wrote, and raises
      `run already closed` having written nothing. A stale screen cannot finish a run it has not
      seen. `finish-shopping-run.pglite.test.js` proves the SEQUENTIAL form (second call refused,
      exactly one open run, no item carried twice, the whole table byte-equal before and after
      the refusal); pglite is one connection, so the interleaving itself is #356's, on the live
      project. `shopping_runs_one_open_per_list` (`0032`) stands behind the lock: any path that
      reached the second insert with an open run already on the list is refused by the index and
      the whole call rolls back — and deleting the `run already closed` guard reddens the two
      tests that assert the refusal's WORDING, which is how the suite tells the guard from the
      index (predicted 2, actual 2).
    - **No grant moves, and the function is the only writer of `closed_at`, `closed_by_member_id`
      and a carried item.** `authenticated` still holds no INSERT and no UPDATE on `shopping_runs`
      at table or column level (SELECT on its six columns is everything) and no INSERT on
      `shopping_items`; the suite asserts the exact sets and the behavioural refusal of a direct
      write to either stamp column. The close is stamped from `now()` and the closer from
      `acting_member(household)` — the caller's member row IN THAT household, which the
      two-household fixture makes a real assertion (a mutation stamping nobody reddens 2). The
      signature is exactly `run_id uuid`: the AC 4 mutation replacing `now()` with a client-supplied
      timestamp PARAMETER reddened the signature test, the second-apply test and the
      `LIVE_RPCS`-versus-`pg_proc` comparison, plus every call in the suite by coupling
      (predicted 18, actual 19 (one over: the execute-privilege test names the one-argument signature too)); the narrower form — `closed_at` written from a
      smuggled constant — reddened the three clock tests and nothing else (predicted 3, actual
      3). Withholding `grant execute … to authenticated` reddens the privilege test,
      the second-apply test and, by coupling, every call (predicted 17, actual 17).
    - **A carried item keeps its original adder and `added_at`, plus `carried_from_item_id`**
      (owner decision, 2026-09-05, recorded on the epic and on #354). The finisher is the one
      member known NOT to have added the item, and preserving `added_at` keeps carried items at
      the top of the next run's unbought order. The originals are COPIED, never moved: the closed
      run keeps all five of the fixture's rows as the record of what that trip did not manage,
      which is what #359's past runs show — it reads exactly those rows back, through the
      client grants `0032` already gives, adding no table, no grant and no migration. Each of the three copy fields has its own
      mutation — the finisher as adder, `now()` as `added_at`, `null` as the origin — and each
      reddened the carry test alone or with the two AC 2 tests that count origins (predicted
      1 / 1 / 3, actual 1 / 1 / 3). Dropping the
      `purchased_at is null` filter carries the bought items too and reddens six (actual
      6).
    - **`closed_at` and the new run's `opened_at` are the same transaction-start clock reading**
      — asserted as SQL equality between the two rows. It pins `now()` (transaction start) over
      `clock_timestamp()` on both stamps; it does NOT prove atomicity, which a plpgsql body has by
      construction and no mutation of the file could remove — the review's test-vacuity lens
      corrected a first draft that titled it the proof of one transaction.
    - **The finish lock covers finish-against-finish only, and `0032`'s three item writers are
      replaced here to close the rest** — found by the same review before the file reached any
      project. `add_shopping_item`, `purchase_shopping_item` and `unpurchase_shopping_item` read
      `closed_at` with no lock on the run row, so an add or un-purchase overlapping a finish would
      land an unbought item on the just-closed run (never carried, "nothing lost" false), and a
      purchase overlapping a finish would, in one of the two orderings, leave the item bought on
      the closed run AND copied unbought onto the next. Two clauses close it, belt and braces:
      the three writers take `for key share` on the run row BEFORE they touch the item — a key
      share conflicts with the finish's `for update`, so a writer arriving during a finish waits
      and re-reads the close; one arriving first holds the run until it commits so the finish's
      carry sees the write — and the carry's `insert … select` locks its source rows
      `for update`, so an item a purchase or a remove already holds makes the copy wait and the
      re-check skips a row that is bought or gone rather than copying or referencing it (which is
      what stood between a concurrent remove and a raw `23503` aborting the whole finish). The
      lock ORDER is load-bearing and is the same in every writer — run, then item — because a
      purchase that locked the item first and the run second would deadlock with a finish holding
      the run and waiting on the item. Signatures, refusals and stamps of the three are unchanged
      and `shopping.pglite.test.js` passes against them unedited; what a single pglite connection
      can observe of the clauses is the catalog, and `finish-shopping-run.pglite.test.js` reads
      each body for its lock and its order (the mutations dropping the add's key-share, swapping
      the purchase's order and dropping the carry's `for update` reddened 1, 1 and 2 as predicted — on a second run for the first: its first run reddened 0 because the assertion matched the body's own comment naming the clause, so the regexes are anchored on the clause's terminator now, with a control that the comments alone match none).
      **Not closed here, filed as #368**: a client `delete` that arrives after the
      carry has locked the item waits for the finish and then proceeds against the original under
      a policy evaluated on its own older snapshot — the closed run loses its record of the item
      while the copy survives on the next run. The delete path is `0032`'s policy and a policy
      cannot lock the run. And the mirror hazard, stated: re-pasting `0032` on top of this file
      puts the three UNLOCKED bodies back (cairn's `0004`-over-`0007` shape); the suite asserts
      that direction so it is written down rather than discovered.
    - **The interleaving is PROVED against this project, not inferred from the source** — #356,
      `npm run prove:finish-race`, measured 2026-09-06. Everything above about the lock is a claim
      about two transactions being open at once, and until this story **no instrument here could
      reach it**: pglite is one connection, so `finish-shopping-run.pglite.test.js` runs the two
      calls back to back and what it proves is the stale-screen guard, never the contended lock.
      *What pglite could not prove and this did*, in one line each:
      - **The outcome, ten times.** Two independent authenticated clients on the seeded account,
        both `finish_shopping_run(run_id)` inside one `Promise.all` against a fresh list each time
        (one open run, three unbought items, confirmed by a read first): **10 of 10** gave exactly
        one new run and exactly one refusal, and the read-back was identical every time — two runs
        on the list, three items on the new one each carrying exactly once from an original the
        closed run still holds, none bought, none moved. **40 of 40 over four runs of the script.**
      - **Which refusal path, which #357 needs.** All ten took the RPC's own `run already closed`,
        **none** the `shopping_runs_one_open_per_list` violation and **none any other path** — so
        the second caller waited on the row lock and re-read the close, exactly as the header above
        says, and the index stayed the belt under the braces rather than the thing doing the work.
        #357's error copy therefore has one SQLSTATE to map (`P0001`) on this evidence, not two.
        The third count is not a formality: a loser cancelled behind a slow winner comes back
        **57014**, having never reached the lock, and a repetition like that proves nothing while
        looking identical in every other column — so it is a fault rather than a footnote.
      - **The interleaving itself, read out of the server, and it is the ONLY evidence of it.** The
        outcome alone is not evidence — a platform that ran the two calls end to end produces the
        same one winner and one refusal, which is what pglite already shows — so the script carries
        a witness: a race over **8,000** bulk-loaded rows, slow enough to sample while it happens.
        **Eight of eight samples taken, none failed, every one showing two `active` backends inside
        `finish_shopping_run` with a `transactionid` lock wait among them — witnessed in sample 1**
        (winner 5,652 ms, loser 5,687 ms, 8,000 carried and 8,000 kept). That is the second caller
        blocked on the first's `for update`, observed rather than argued. A miss is reported as a
        miss, and a FAILED sample is counted apart from an empty one.
      - **The `for key share` clauses, on live.** Twenty purchase-versus-finish races across the
        four runs, **both orderings observed** — the tick committing first and the carry then
        skipping the bought row, and the tick arriving during a finish and being refused
        `run already closed`. No item was ever bought on the closed run AND carried forward, which
        is the double-buy the clauses exist to make unreachable. **Not** covered, and unchanged:
        the client `delete`, which is #368.
      - **Four bounds on the instrument — two found by running it, two by review, none by reading
        the code.** A client read-back of the witness run is silently capped at PostgREST's
        `db-max-rows` (**475 of 20,000 rows, no error and no gap in the response**), so the count
        goes through `head: true`; at 20,000 items the carry ran past `authenticated`'s **8 s
        `statement_timeout`** on one run of two, killing the WINNER mid-carry so both callers came
        back refused, which is why the fixture is 8,000 and the phase retries. Review then found
        two more: the retry loop reported the **last** attempt rather than the one that stands, so
        a machine-killed final attempt could fail a proof two clean attempts had already made —
        repaired by fault KIND rather than by preferring clean attempts, because an attempt that
        saw **two winners** is the epic's own defect and must reach the report from wherever it
        happened; and the verdict was computed as a max and a sum **across** samples, so the two
        halves of the sentence could come from different instants. **The final run used the
        corrected instrument and reached the same verdict as the run before it** — which is why the
        figures here were re-measured rather than carried across.
    - **What is NOT here, on purpose**: no `list_id` overload, no undo (owner decision 8: an
      inline confirm, no undo), no client-side close of any kind, and no backfill — every run
      open before this file stays open until somebody finishes it from a phone.
  - **`0011` also needed a DEPLOY, not only a paste**, and it was the only migration on this page
    that did until `0030`: `calendar-connect` is an Edge Function, and `npm run deploy:function` is what puts it
    there. Two actions, two expected reds — and, as this page said it would, **the paste cleared
    only its own**. Both have now happened.
  - **`check:live` is blind to `0009` and NOT blind to `0010` or `0011`, and the difference is worth
    knowing
    because it is a property of the migrations rather than of the check.** `0009` changes only two
    indexes, and the check covers tables, columns, RPCs and Edge Functions — so it stays green
    either way and its green is *not* evidence that `0009` has been pasted. **That is not a stale
    warning now that the paste has happened — it is the reason `0009` is confirmed by a different
    instrument entirely**: this check's green read the same on both sides of that paste, so it
    carries no information about it in either direction. `npm run test:rls` is what settles it, and
    it settles it at setup rather than in an assertion. `0010` creates a TABLE the client reads, so
    the check could see it and was red on it by design until the paste. One migration ahead of the
    project was invisible to the instrument and the other was loud, from the same instrument, on the
    same day.

    `0011` is a third case and it is **half visible**, which is the sharpest of the three.
    `calendar_connections` is read by the client, so the check asks about it and was red until the
    paste. `calendar_tokens` is **deliberately not in `LIVE_SCHEMA`**, and its absence is the check
    agreeing with the schema rather than an omission: no client is granted anything on that table,
    so a probe would report a missing grant on a project that is entirely correct — the
    `household_devices` mistake with the sign flipped. Both tables arrive in one file, so a project
    with the connection table has run the whole of it. `liveSchema.test.js` asserts the token table
    is absent from the list rather than leaving that to be inferred, because an entry left out on
    purpose and one forgotten look identical.
- **`0013` (#91) is the odd one out: it grants privileges the live project already has.** Supabase's
  default ACL for tables created by `postgres` in `public` used to be `arwdDxtm` and is now `Dxtm` —
  truncate, references, trigger, maintain, and no DML at all. Every migration up to `0012` that
  wanted to keep a privilege wrote a NARROW revoke and let the rest ride on that default, which
  works only while the default is generous. *Measured 2026-08-24* against a database built from
  `supabase/migrations/` alone, three of the seventeen operations the client issues were refused:
  `households` `select('*')` (the app cannot load past the shell), `members` delete and `chores`
  delete (removing a person, removing a chore). All four DELETE policies already existed and were
  correct — only the grants were missing, which is why `0013` contains no policy.

  The pattern predicts where a fourth instance would be. `member_capacity` (`0005`) and
  `chore_exclusions` (`0010`) each write `grant delete` explicitly and are fine; `members` (`0002`,
  `0007`) and `chores` (`0003`) narrow their revoke and inherit the rest, and both were broken.
  `0003` even says so in prose at line 161 — *"DELETE stays granted to `authenticated`"* — which was
  true of the platform it was written against and has not been true since. **Nothing executes a
  comment**, so it went on reading as a decision.

  **Pasted 2026-08-26 (#150).** The "changes nothing observable" half of what this bullet used to
  say turned out to be wrong: it changes nothing observable *to any client*, and it writes five rows
  of `pg_attribute.attacl` that say plainly that it ran. What it is FOR is unchanged — on a project
  rebuilt from these files it is the difference between an app that loads and one that does not.
- **This page is prose about live state and prose is what failed here** — see the correction at the
  head of *What is not done*. Since #78 the authority is a **check, not this page**: run
  `npm run check:live` and believe its output. What is written here is the *reasoning* — why each
  migration exists and what it grants — which is the half a check cannot carry.
- **#99 opened ONE row on 2026-09-08 — a DEPLOY's row, not a paste's — and drained it in its own
  session.** `calendar-disconnect` is the Edge Function that deletes a member's token row, every
  derived busy row and the connection row, and asks Google to revoke the grant best-effort. It
  arrives with **no migration at all**: `0011` and `0030` already created the three tables it deletes
  from and already grant `service_role` the DELETE it uses, so there is nothing to paste and nothing
  a paste could clear. The row was red from the moment `LIVE_EDGE_FUNCTIONS` listed the name until
  `npm run deploy:function` shipped it: *measured **48 of 49** immediately before the
  deploy and **49 of 49** immediately after*, the denominator having moved from 48 to
  49 on the one new function. Written down here and in README's `check:live` cell in the same change
  that created the row, for the reason the #352 bullet below gives.

  **What this check still cannot see about it, stated because the gap is wider here than usual.** A
  preflight carries no body and invokes nothing, so a green row says the gateway has the function
  and a browser could call it — and says nothing about whether the three deletions actually
  succeed, which needs `service_role` to hold DELETE on all three tables. That half is
  `npm run probe:live-grants`'s and `src/test/grants.pglite.test.js`'s, and it was already true
  before this story: `0011` and `0030` grant it, and the catalog reading recorded under those two
  entries is what says the live project agrees.
- **#360 opened THREE reds on 2026-09-06 and drained all three in its own session** — the
  `archive_shopping_list` and `unarchive_shopping_list` RPC probes, red from the moment `LIVE_RPCS`
  listed them, and the `shopping_lists` TABLE probe, which went red the moment `archived_at` joined
  `SHOPPING_LIST_COLUMNS`. All three until `npm run migrate:live` applied `0035`: *measured
  **44 of 48** before and **47 of 48** after*,
  the denominator having moved from 46 to 48 on the two new functions and NOT on the column — a
  table is probed once, with every column the app selects, so a new column reddens an existing row
  rather than adding one. Written down here and in README's `check:live` cell in the same change
  that created the rows, for the reason the #352 bullet below gives. The set is back to the one row
  below.
- **#368 opened ONE row on 2026-09-06 and drained it in its own session** — the
  `remove_shopping_item` RPC probe, red on purpose from the moment `LIVE_RPCS` listed it until
  `npm run migrate:live` applied `0034`: *measured **44 of 46** before and
  **45 of 46** after*, the denominator having moved from 45 to 46 on the one new
  function. Written down here and in README's `check:live` cell in the same change that created
  the row, for the reason the #352 bullet below gives.
- **#354 opened ONE row on 2026-09-05 and drained it in its own session** — the
  `finish_shopping_run` RPC probe, red on purpose from the moment `LIVE_RPCS` listed it until
  `npm run migrate:live` applied `0033`: *measured **43 of 45** before and
  **44 of 45** after*, the denominator having moved from 44 to 45 on the one new
  function. Written down here and in README's `check:live` cell in the same change that created
  the row, for the reason the #352 bullet below gives. The set is back to the one row below.
- **#352 opened SEVEN rows on 2026-09-05 and drained all seven in its own session** — the three
  `shopping_*` table probes and the four shopping RPC probes, red on purpose from the moment the
  entries were listed until `npm run migrate:live` applied `0032`: *measured **36 of 44** before
  and **43 of 44***. They were written down here and in README's
  `check:live` cell in the same change that created them, for the reason the next bullet's history
  gives. The set is back to the one row below.
- **#210 opened ONE row on 2026-09-04 and #209 DRAINED it on 2026-09-07 — the set is EMPTY again,
  and this is the longest any row here has stood: four days across five stories.** The
  plain-language capacity flow (`src/lib/capture.js`) invokes `extract-description` by name ahead of
  #208 writing it — owner decision at #210's pickup — and `LIVE_EDGE_FUNCTIONS` lists what the app
  invokes, so the probe answered NOT DEPLOYED: *measured 2026-09-04 at 36 of 36 immediately before
  the name was listed and 36 of 37 immediately after*, in #210's own session, the one red naming
  exactly that function. Not a migration's row and not a paste's: the action that cleared it was
  `npm run deploy:function`, and nothing else could have. **#208 wrote the function on 2026-09-07**
  (`supabase/functions/extract-description`, with `0036` for its call ledger), moving the name from
  `PENDING_FUNCTIONS` into `FUNCTION_NAMES` in `scripts/deploy-function.mjs` — that list's own test
  went red on the new directory, which is what it is for. **#209 ran the deploy on 2026-09-07**:
  *measured **47 of 48** immediately before and **48 of 48** immediately after*, the denominator
  unmoved, the one red naming exactly that function on the before side and no red at all on the
  after side. Deployment **v2**, `ezbr_sha256`
  `46499420bb93ab3e9988b20485db12a9e648eaaaa3600a496bc2cf86aa57787a`, 2026-09-08T01:47:25.642Z.
  Every red, on any subject, is real again.

  **Two things this row is worth remembering for, neither of which is the reading.** It is the first
  entry here whose clearing action was a **deploy** rather than a paste — `0036` went in on #208's
  session and moved no figure at all, so a reader watching the migration entries would have seen
  nothing happen for four days while the row sat red for a reason no migration could touch. And the
  deploy it waited on is the first in this repo whose bundle carries files from **outside** the
  function's own directory: `--use-api` uploaded `src/lib/extraction.js`, `src/lib/dueDates.js` and
  `src/lib/extractionAdapter.js` alongside the two handler files, which #208 could only read off the
  CLI's Go source and record as unmeasured. It is measured now, and the `_shared/` fallback
  docs/deploy-runbook.md §3c step 1 held in reserve is not needed.

  **`check:live` cannot see the half that made the function useful.** The row went green on the
  deploy alone, and a deployed `extract-description` with no `ANTHROPIC_API_KEY` refuses every call
  by name — a preflight carries no body and invokes nothing, so this instrument reads the same
  either way. What proved the secret is a POST with a real session, and it is recorded on #209:
  200 carrying the contract shape for both `capacity` and `chores`, against a 401 with no session,
  the function's own 403 from a household the caller is not in as the control that the refusal is
  not the gateway's, and two rows in `extraction_calls` for the two answered calls.
- **Before #210 the set was EMPTY again; #96 had opened TWO and both drained on 2026-09-04**: the
  `calendar_busy` table probe on `0030`'s apply, and the `calendar-busy` Edge Function probe on
  its deploy, each on its own action and neither on the other's — *measured 2026-09-04 at 34 of
  36 before and 36 of 36 after*, in #100's session. They were written down here at the moment they
  were created rather than at the moment somebody noticed, because this page has gone stale on
  exactly this seam three times and the entry below says so. The denominator #96 wrote for them
  was 34; it read 36 because #268 landed the same day and its rows count too.
- **Before #96, the excused-red set was EMPTY. *Measured 2026-09-02 at 32 of 32*, on both sides of `0028`'s
  apply in #306's own session — the denominator unmoved, because that file replaces a function
  body and this check probes a function only by name and argument set; the reading before the apply
  is the same as the reading after, and what separates them is the `pg_get_functiondef` read
  recorded in that migration's entry above.** Before that, *measured 2026-09-01 at 32 of 32*, after
  `0027` was applied in
  #305's own session — the denominator moved from 30 when that story added two RPC probes
  (`miss_chore`, `unmiss_chore`) beside widening the `chores` column list, and all three of its
  pre-apply reds cleared on exactly the apply: *29 of 32 before, 32 of 32 after*.** Before that,
  *measured 2026-08-31 at 30 of 30*, after `0026` was applied in
  #103's own session (denominator unmoved — that story widens the existing `chores` column list, and
  its one pre-apply red, `42703` on `chores.repeat_monthday`, cleared on exactly the apply: *29 of
  30 before, 30 of 30 after*). Earlier the same day, at the same figure after `0025` was applied
  in #105's own session — the denominator moved from 28 when that story added a table entry and an
  RPC probe, and both of its reds cleared on the apply (*measured 28 of 30 before, 30 of 30 after*).
  Before that: *measured 2026-08-28 at 28 of 28*, after `0023` was applied in
  #211's own session, and at the same figure before it for #250's two seeded-account rows.
  `0023` (`chores.source`, #211) is the second migration running to be applied inside the story that
  needed it, so like `0021` it never entered this set — but unlike `0021` both readings were taken:
  *27 of 28 before, `chores` answering `42703` on `chores.source`; 28 of 28 after*. That before-reading
  is cheap and is worth making a habit of, because it is the only thing separating "the apply worked"
  from "the entry was never going to be red anyway" — `0022`'s entry above has to reason its
  before-state from two artefacts for want of one command.
  #250's two rows are the first entries here whose subject is not the
  live project at all — they ask whether `TASKR_TEST_EMAIL` can still sign in, because the account
  behind it was deleted around 2026-08-25 and `npm run test:rls` threw in a `beforeAll` for four days
  while reporting `numFailedTests: 0`. They can never be excused: an excused sign-in row would be a
  check that has agreed not to notice it is dead. The reading before them, and the last one whose
  denominator a migration could move: ***measured 2026-08-28 at 26 of 26*, after `0021` was applied in
  #59's own session — and measured the same day at the same figure after `0020` was applied in
  #50's.** `0021` never entered the set: it widens the `member_split_seen` column list (the
  fairness note's dismissal flag), which would have answered `42703` until applied, and the apply
  landed in the same session as the code that reads it. The row it held while #50 was being built — `member_split_seen` answering
  `PGRST205`, cleared only by applying `supabase/migrations/0020_split_seen.sql` — was *measured
  standing at 25 of 26*, then drained the same session by `npm run migrate:live` (the route #185
  built and #231/#235 proved), and both readings were taken rather than assumed. The application
  came BEFORE the `release` promotion on purpose: the deployed client changes only on a promotion,
  so the table existing first is the safe order.

  Before #50 widened the instrument, the set was EMPTY — *measured 2026-08-27 at 25 of 25*, after
  `0018` was applied
  (#231). The two rows it held between #49's merge and that paste — `chores` answering `42703` on
  `assigned_source`, and `apply_assignments` answering `PGRST202` — both cleared on exactly the one
  action they named, and are moved into the history table below rather than left standing. The
  denominator moved from 24 to 25 when #49 added the `apply_assignments` probe. Before that, the set
  was EMPTY — *measured 2026-08-26 at 24 of 24* after
  `0015` was pasted (#194), and *re-measured 2026-08-27 at 24 of 24* across the `0016` paste (#198),
  which is blind to this check and so could not have moved either number. It held one row for most of that day — `chores` until `0015` arrived,
  re-opened by #12 asking for a column the live project did not have yet — and the row was
  DELETED when the paste landed rather than re-pointed at something else, because an empty set is
  the whole source of the check's authority. A row that outlives its action reads exactly like one
  that never drained. The earlier reds are in the table further down,
  beside the single action that cleared each. What follows is the history, most recent first.

  *Two rules this page paid for on 2026-08-26, kept here because the NEXT excused row will need
  them. **A row whose clearing condition is an action by a person must cite an OPEN issue.** That
  row cited `(#12)` until PR #200; #12 had closed COMPLETED hours earlier when PR #195 merged, so
  the citation named a finished story while the paste was still owed — and an auditor following it
  would have concluded the paste had happened. The issue that INTRODUCED a column is not the issue
  that owes its paste. **And the row is cleared by the instrument, never by a report.** The paste
  was stated as done once while `check:live` still read 23 of 24 on three probes two minutes
  apart; the real paste followed, and the same command read 24 of 24. Both readings were correct
  and only the second licensed this edit.*
  ***Measured 2026-08-26*** against the live project, on the #159 branch before
  the paste: **22 of 24**, with `members` and `chores` each answering
  `42501 permission denied` because the client now asks for `household_id` and
  the live project has not granted it. That is the check working, not a fault -
  and unlike `0013` it is a red that could not have been faked, because the
  column has never been readable by `authenticated` on any project.
  ***Measured 2026-08-24*** against the live project, after `0012` was pasted that evening:
  **24 of 24**. The two reds this bullet carried for part of that day — the `chores` repeat columns
  and `catch_up_repeats()` — cleared on exactly the one action they named, and on nothing else.
  Nothing is on loan: the check's authority is whole, and a red on any subject is a real failure
  rather than a queued paste.

  **The empty set is the state this whole form exists to reach, and it is the state to defend.**
  While a red is excused, the check's authority is on loan: a genuine failure of the excused subject
  reads as the expected one and gets waved through, which is precisely how a real outage hid in
  plain sight on 2026-08-09. With nothing excused, the instrument answers the only question worth
  asking in one bit.

  **The excused-red set held nothing between `0018`'s application and #50, held `0020`'s one row
  within #50's session, and was EMPTY again until #210 opened the `extract-description` row on
  2026-09-04 — see the head of this bullet.** *Measured 2026-08-27 at
  25 of 25* after `0018` was
  applied under
  #231. It held TWO rows between #49's merge and that application, and both are moved into
  history below rather than left standing — the same reasoning as every block under it, and the
  reason the rows were written to be deletable by one reading: while they stood, the check's
  authority over `chores` and over the RPC list was on loan.

  **The two rows that stood here between #49's merge and the `0018` application are moved into
  history rather than left standing.** Both named the same single clearing action, and both cleared
  on exactly it:

  | Red that stood here | Cleared by | Held? |
  |---|---|---|
  | `chores` refuses `assigned_source` (`42703`) | applying `supabase/migrations/0018_stored_reassignment.sql` (#231), after `0017` | Yes. Not a deploy, not a promotion to `release`, not another migration. |
  | `apply_assignments` unresolved (`PGRST202`) | the same file (#231) | Yes, and together: one action created the column and the RPC, which is why the application was one story rather than two. |

  Neither red could be faked by a grant, which is why they were worth excusing at all: a `42703` is
  refused before the privilege check, and a `PGRST202` is PostgREST's own cache never resolving the
  function. **`0018` was applied with `npm run migrate:live` rather than pasted by hand** — the route
  #185 built — so the payload is confirmed from the far end as well as from the reading: Postgres
  reported back 17314 characters and md5 `8d93ea98cfc53f9069a7f6811ca02511`, identical to the file.

  **The row that stood here between #12's merge and the `0015` paste is moved into history rather
  than left standing**, on the same reasoning as the two below it:

  | Red that stood here | Cleared by | Held? |
  |---|---|---|
  | `chores` refuses `actual_minutes` (`42703`) | pasting `supabase/migrations/0015_actual_minutes.sql` (#194) | Yes. Not a deploy, not a promotion to `release`, not another migration. The paste also re-points `complete_chore` to seed the zero-tap default; same signature, so no function probe moved — the column was the only observable. |

  **The two rows that stood here between #159's merge and the paste are moved into history rather
  than left standing** — that is #162 AC 1's first half, discharged here rather than left for #162,
  because a stale excuse is indistinguishable from a live one and it excuses precisely the subject
  most likely to fail next. Both cleared on exactly the action they named, and on nothing else:

  | Red that stood here | Cleared by | Held? |
  |---|---|---|
  | `members` refuses `household_id` (`42501`) | pasting `supabase/migrations/0014_scope_reads_to_one_household.sql` | Yes. Not a deploy, not a promotion to `release`, not another migration. |
  | `chores` refuses `household_id` (`42501`) | the same paste — the file grants both tables in one go | Yes, and together: there was never a state in which one was granted and the other was not. |

  **`0014` is observable to `check:live` and `0013` is not — but that is a fact about the CHECK,
  not about which pastes can be confirmed.** `0014` grants a column that has never been readable by
  `authenticated` on any project, and every table probe is `select(<columns>).limit(0)` signed in as
  that role, so its red is real before the paste and gone after it. `0013` granted privileges the
  live project already held by inheritance, so nothing reachable over PostgREST reads differently
  across it. Both were nonetheless confirmed on 2026-08-26 (#150), by two different instruments:
  `check:live` for `0014`, and the column ACL in the catalog for `0013`. The corrected `0013` bullet
  below carries that measurement, because this page asserted the opposite for two days.

  **What follows describes the state before #159 and is kept as history.** The two rows that
  stood here earlier on 2026-08-24 — the `chores` repeat columns and `catch_up_repeats()` — were
  both cleared by the single paste of `supabase/migrations/0012_repeating_chores.sql` that evening,
  *measured* at **24 of 24**. They are recorded in the inversion history below rather than left
  standing here, because **a drained queue nobody re-reads looks exactly like one that never
  drained**, and an excused row that outlives its condition is the failure this form exists to
  prevent.

  **Both of the rows that stood here on 2026-08-24 cleared on exactly the action they named, and on
  nothing else** — which is the claim this table makes every time, and the reason it is written as a
  table rather than a sentence:

  | Red that stood here | Cleared by | Held? |
  |---|---|---|
  | `chore_exclusions exists, with every column the app selects` | pasting `supabase/migrations/0010_chore_exclusions.sql` | Yes. Nothing else touched it. |
  | `calendar-connect is deployed, and a browser could actually call it` | `npm run deploy:function` | Yes, and the sharper half: **the `0011` paste did not clear it**, exactly as the row predicted. A migration and a deploy are different actions against different systems, which is the whole reason `LIVE_EDGE_FUNCTIONS` is a separate list. |

  *A third row stood for about an hour on 2026-08-24 — `calendar_connections`, awaiting the `0011`
  paste — and cleared on exactly the action it named too. It is recorded here rather than deleted
  because a row that appears and clears within a session is the same evidence as one that stands for
  days; deleting the short-lived ones would leave a history that flatters the queue.*

  The two eligibility functions `0010` creates are deliberately **not** probed, and their absence
  from the check is not a gap: `0010` withholds `execute` from `authenticated`, so a probe would
  report a missing grant on a project that is entirely correct — the `household_devices` mistake
  with the sign flipped. They arrive in the same paste as the table, so a project with the table has
  run the whole file.

  **`0009`, `0013`, `0016` and `0017` are the four migrations this bullet cannot speak for at
  all**, and it
  is worth
  stating here rather than only four bullets up, because an empty excused-red set is easy to read as
  *the database matches the repo* and it does not mean that. The check covers tables, columns, RPCs
  and Edge Functions.

  - **`0009`** is two indexes, so this bullet would read exactly the same whether that migration had
    been pasted or not. It has been — `npm run test:rls` confirms it, at setup — but the
    confirmation comes from somewhere else entirely.
  - **`0013`** (#91) is three grants, and it is blind to `check:live` in a way `0009` is not:
    `0009` is invisible because the check has no index probe, while `0013` is invisible because
    **the live project already holds all three privileges by inheritance**. The check signs in as
    `authenticated` and reads `households` with `select('*')`; that succeeded before `0013` existed
    and succeeds after it is pasted. There is no reading of `check:live`, and no reading of any
    instrument reachable over PostgREST, that differs across that paste — `information_schema` is
    not exposed.

    **This bullet used to end "the only difference `0013` makes on the live project is a catalog
    entry nobody can query", and called that paste "unobservable by design rather than by
    omission". Both were wrong, and #150 measured them wrong from the SQL editor on 2026-08-26.**
    The catalog entry is real, it is exactly where the sentence said it was, and it is queryable by
    anything that can run SQL — which the dashboard can and PostgREST cannot. The true scope of the
    claim is *no client-facing instrument*; *nobody* was one word too strong, and the difference is
    the whole story, because one version says the paste is unverifiable and the other says you have
    to ask a different system.

    What `0013` writes on the live project, and what it does not — *measured 2026-08-26*:

    | Catalog | Before | After | Why |
    |---|---|---|---|
    | `pg_attribute.attacl` on `households.id`, `.created_at`, `.organizer_member_id` | no column-level grant | `authenticated=r/postgres` | `0013` statement 1. **No other migration grants column-level select on `households`** — `0005` is the only other file that touches that table's privileges, and it grants `update (name, timezone)`. These three entries can only be `0013`'s. |
    | `pg_attribute.attacl` on `households.name`, `.timezone` | `authenticated=w/postgres` | `authenticated=rw/postgres` | the `w` is `0005`'s update grant; the `r` is `0013`'s. |
    | `pg_class.relacl` on `members` and `chores` | `authenticated=dDxtm/postgres` | unchanged | statements 2 and 3 grant a privilege already held, so they are no-ops in the catalog as well as in behaviour. |

    So the AFTER probe #150 asked for reads **`t / t / t`** — and so did the BEFORE row, which the
    issue predicted and which is now **derived from the post-state rather than assumed**. That
    derivation is the only reason "no difference" is a measurement instead of a shrug:

    - `hh_select` was already true because `households`' TABLE-level ACL carries
      `authenticated=ardDxtm` and **no migration has ever granted table-level select on
      `households`** — so that `r` is the inherited default, and it predates `0013` by months.
    - `members_delete` and `chores_delete` were already true, and **`anon` is the control that
      proves it.** `0002` and `0007` each revoke `select, insert, update` from `authenticated, anon`
      in one statement, and `0013` grants only to `authenticated`. The live `members` ACL still
      reads `anon=dDxtm` — so `d` survived that narrow revoke by inheritance for anon, and
      `authenticated`, which took the identical revoke in the identical statement, kept it the same
      way. `chores` corroborates from the other side: `0003` revokes **all** from anon, and the live
      `chores` ACL has no anon entry at all.

    **The general form is worth more than this file:** a column-scoped grant of a privilege the role
    already holds is invisible to every behavioural probe and permanently visible in
    `pg_attribute.attacl`. A paste like this one stays verifiable after the fact, indefinitely, by
    whoever thinks to ask the catalog instead of the API.

    None of this changes what `0013` is for. It is a no-op on the live project (#91 AC 5); what it
    changes is a project rebuilt from these files, where those privileges do not exist at all and
    the app cannot load past its first screen. `src/test/grants.pglite.test.js` is still the
    instrument that covers that, in CI, against the migrations rather than against the project —
    and it is still true that **that** coverage cannot be moved over the wire.

  - **`0016`** (#152) is one RLS policy and nothing else, so it is invisible for a third distinct
    reason: not a missing probe (`0009`) and not a privilege already held (`0013`), but a **subject
    the check does not read at all**. `check:live` reads tables, columns, RPCs and Edge Functions;
    a policy is none of those, and no policy change can move its reading in either direction. There
    was never an expected-red row to add, because there was no red available to excuse.

    *Measured 2026-08-27, both sides.* `check:live` read **24 of 24** before the paste (2026-08-26,
    after `0015`) and **24 of 24** after it, and the denominator cannot have drifted between the two
    readings: `src/lib/liveSchema.js` and `src/test/schema.integration.test.js` last changed
    2026-08-24. **That agreement is recorded here precisely so a green run is not mistaken for
    evidence the paste happened** — it is the same reading the check would have given had `0016`
    never been pasted at all.

    What confirms it is the **post-state**, read the way `0013`'s was — SQL against the catalog,
    which the dashboard can run and PostgREST cannot. *Measured 2026-08-27*, the live
    `pg_get_expr(polqual, polrelid)` for `members_delete_same_household` on `public.members`:

    ```
    ((household_id IN ( SELECT current_household_ids() AS current_household_ids))
     AND (claimed_by IS DISTINCT FROM ( SELECT auth.uid() AS uid))
     AND is_household_organizer(household_id))
    ```

    The third clause is `0016`'s and can only be `0016`'s — no other migration references
    `is_household_organizer` in a policy on `members`. The first two are `0001`'s and `0007`'s,
    unchanged, which is the other half of the check: this migration was supposed to **narrow** the
    predicate, not rewrite it, and the self-removal clause `0007` argues for at length is still
    there. `is_household_organizer` deparses unqualified because the policy was created with it on
    the search path; that is how Postgres renders it, not a sign the schema qualifier was dropped.

    **Why the post-state and not a ledger.** Nothing in this repo records which migrations have
    reached the project, and the natural response to not knowing is to paste again to be sure.
    Re-pasting `0016` is genuinely harmless — `drop policy if exists` then `create policy` — but
    the habit is what matters, and asking the database what it currently holds answers the question
    for every migration rather than for the safe ones.

  - **`0017`** (#186) is a fourth, and it is blind for a fourth distinct reason — not a missing probe
    (`0009`), not a privilege the role already holds (`0013`), not a subject the check does not read
    (`0016`), but **a ROLE it never asks about**. `check:live` signs in as `authenticated` and asks
    the questions the client asks. `0017` revokes what `anon` holds, and `anon` is the role an
    unauthenticated browser gets — one the app never uses, because `src/App.jsx` skips its reads
    entirely when there is no session. No reading of this check differs across that paste, in either
    direction.

    What `0017` removes, *measured 2026-08-27* over `pg_class.relacl` and `pg_attribute.attacl` for
    **every relation in `public`** — seven tables, 51 columns:

    | Catalog | Before | After | Why |
    |---|---|---|---|
    | `pg_class.relacl` on `households` | `anon=ardDxtm` | no `anon` entry | INSERT, SELECT and DELETE that **no migration granted**. `0002`-era platform default, surviving `0005`'s narrow `revoke update`. |
    | `pg_class.relacl` on `members` | `anon=dDxtm` | no `anon` entry | DELETE, same way: `0002` and `0007` each revoke `select, insert, update` and let the rest ride. |
    | `pg_proc.proacl` on `complete_chore(uuid)`, `uncomplete_chore(uuid)` | `=X` and `anon=X` | neither | `0004` revoked `execute` from `public, anon` for `acting_member` and not for these two, three lines below. |
    | `pg_class.relacl` on the other five tables | no `anon` entry | unchanged | `chores` because `0003` revoked ALL; the other four because they were created after the platform tightened its defaults. |
    | `pg_attribute.attacl`, all 51 columns | no `anon` entry anywhere | unchanged | `anon` has never held a column-level grant on this project. |

    **The function row is the one that would have mattered.** A `security definer` function runs as
    its owner, so RLS has no say in it — the sentence below about every policy being
    `to authenticated` does not cover it. What refuses an unauthenticated caller is the first
    statement of each body, `if (select auth.uid()) is null then raise`, and the publishable key is a
    JWT with `role: anon` and no `sub`. So the verdict is still defence in depth rather than an
    incident, reached by a different mechanism: one line in a function body, standing where the whole
    policy layer stands everywhere else.

    Everything else here is held by RLS and held completely. Every policy in `public` is
    `to authenticated`; `households` has no INSERT or DELETE policy at all, for any role; nothing
    carries a `to anon` policy. A role with a table privilege and no permissive policy for that
    command is refused every row.

    **The instrument that confirms this paste is `npm run probe:live-grants`**, extended by #186 to
    read every relation in `public` rather than the tables `LIVE_SCHEMA` names. It asks two things
    and the second is the one worth having:

    - `anon` holds nothing — no table-level entry, no column-level entry, and no function in `public`
      it may execute, PUBLIC grants included. Stated as a rule rather than a list, so an eighth table
      is audited the day it lands.
    - **`authenticated` is exactly where it was**, on all seven tables. That is the control:
      `revoke all on public.households from anon` is one word from `... from authenticated`, and a
      revoke that hit the wrong role leaves the first assertion looking precisely like success. The
      probe refuses on a moved control row and says which failure it is.

    One exemption, named rather than filtered: `rls_auto_enable()` keeps `anon=X` and PUBLIC `=X`. It
    returns `event_trigger`, appears in no file under `supabase/migrations/`, and is Supabase's
    furniture rather than ours — a migration that revokes a platform grant is one that fights the
    platform at its next upgrade. The probe reports an exemption that matched nothing, so it cannot
    quietly become a claim about a function that no longer exists.

    **This file called `0013`'s paste "a no-op on the live project" and #186's own AC 4 calls this one
    "a no-op on any project built from these files". Both are true of BEHAVIOUR and neither is true
    of the catalog** — on a rebuilt project `anon` starts at the modern `Dxtm` and the two revokes
    strip it. Stated precisely here because the loose version of exactly this sentence is what
    produced "unobservable by design", which had to be withdrawn on 2026-08-26.

  **An empty excused-red set is a claim about the subjects the instrument has**, never about the
  ones it does not — and with `0013`, `0016`, `0017` and now `0019` the gap is **five** migrations
  wide rather than one. **All five are now
  confirmed, and none by this check**: `0009` by `npm run test:rls` at setup, `0013` by the column
  ACL in the catalog (#150), `0016` by the policy expression in the catalog (#198), `0017` by
  `npm run probe:live-grants` reading `anon` holding nothing anywhere, and `0019` by that same
  command reading zero moved control rows on 2026-08-27 (#235). **A gap covered
  somewhere else is still a gap here**, which is why this
  sentence stays standing after the confirmations rather than being deleted by them.

  `0019` (#227) is the fifth, and it is worth saying WHY it is not an excused row four screens up,
  because a reader who has just read that migration will look for one. It revokes the table-level
  privileges `authenticated` holds on `households`, `members` and `chores` that no migration
  granted, and re-grants the `households` column reads in the same file. `check:live` asks what the
  client can read; the client reads the same columns either side of the paste, so the check reads
  **25 of 25 before and after** and the excused-red set stays genuinely EMPTY. The instrument that
  *can* see it is `npm run probe:live-grants`, whose `MEASURED_TABLE_ACLS` was moved to the
  post-paste values in the same change — so **that** command reported exactly three moved control
  rows until the paste, and its own output named all three and the single action that cleared them.
  **It was applied on 2026-08-27 under #235**, by `npm run migrate:live`, which read the payload
  back from Postgres at 10,409 characters and md5 `7639fbfc641338bdca8c30b8d72e0125` before
  applying anything. Both readings were taken either side: `check:live` 25 of 25 before and after,
  and `probe:live-grants` three moved rows before and **zero** after, 6 of 6 agreeing with its own
  negative control. There is no excused moved row left, so any moved row now is a real finding.

  *The history of this bullet, which is the argument for keeping it in this form — and it has now
  been inverted many times; this list is the record and the count is not, because the count said
  "fifteen" while the list stopped at #50 and four stories had inverted it since (#210, 2026-09-04):
  EMPTY at 17 of 17, then ONE expected red at 19 of 20 when #115 gave the
  check its first sight of Edge Functions, then EMPTY again at 20 of 20, then ONE again at 20 of 21
  with #37's unpasted table, then TWO at a **measured** 21 of 23 with #37's table still unpasted and
  #95's function undeployed, then **EMPTY at 23 of 23** with both actions taken, then **TWO again
  at a measured 22 of 24** with #53's `0012` in the repo and unpasted, then **EMPTY again at a
  measured 24 of 24** with `0012` pasted the same evening, then **TWO again at a measured 22 of 24**
  on 2026-08-26 when #159 merged with `0014` unpasted, then **EMPTY at a measured 24 of 24**,
  `0014` and `0013` both pasted that afternoon (#150), then **ONE again at a measured 23 of 24**
  later the same day with #12's `0015` in the repo and unpasted, then **EMPTY at a measured
  24 of 24** with `0015` pasted that evening (#194), then **TWO at a measured 23 of 25** on
  2026-08-27 with #49's `0018` in the repo and unapplied, and **EMPTY again at a measured 25 of 25**
  later that day when `0018` was applied under #231 — the first inversion cleared by
  `npm run migrate:live` rather than by a hand paste — then **ONE at a measured 25 of 26** with
  #50's `0020` in the repo and unapplied, and **EMPTY again at a measured 26 of 26** when `0020`
  was applied by `migrate:live` in the same session, the shortest-lived population yet — then
  **TWO at a measured 28 of 30** with #105's `0025` unapplied and **EMPTY at 30 of 30** the same
  hour, **THREE at 29 of 32** with #305's `0027` unapplied and **EMPTY at 32 of 32** in that
  session, **TWO at 34 of 36** with #96's `0030` unapplied and `calendar-busy` undeployed and
  **EMPTY at 36 of 36** when #100 took both actions, and **ONE at 36 of 37** when #210 listed
  `extract-description` ahead of its function existing — **EMPTY again at 48 of 48** when #209
  deployed that function on 2026-09-07, which is the only action that could have cleared it.
  That row is the longest-lived of the lot: four days, across five stories, and the only one no
  paste could touch.
  **#250 is deliberately NOT an inversion either, and for the opposite reason to `0016`'s.**
  It moved the denominator 26 → 28 while the set stayed EMPTY, because its two rows are about the
  seeded test account rather than about the live project — the first time this number has moved on
  something no migration could ever change. A denominator that moves is not an inversion; a
  population that moves is.
  **`0016` (#198) is deliberately NOT one of the
  inversions**, and saying so is the point: it was in the repo unpasted for most of 2026-08-27 and
  the set stayed EMPTY throughout, because a migration made only of a policy has no probe that
  could go red. The check was *re-measured* at 24 of 24 on 2026-08-27 after that paste — a
  re-measurement, not a transition. **Count the inversions from rows this table could have held,
  never from migrations that landed**, or the next blind paste inflates a number whose whole value
  is that it counts something real. A THREE was once written here
  first, from arithmetic, and never actually existed: the paste that would have cleared its third
  entry had already happened. **A predicted state is not a state**, and the register a count is
  written in — measured or derived — belongs beside it.* The non-empty states are the instructive
  ones. The set never grew because anything regressed — it grew because the check stopped being
  **blind** to something already broken, or, as this time, because the repo moved ahead of the
  live project on purpose — the window between a merge and a paste is exactly what the table is
  for, and reading it as a regression would be mistaking the instrument for the fault.

  **The clearing is worth more than the green, because the check's positive control could not
  discriminate until it happened.** While `calendar-connect` was undeployed, the real test and the
  control — a deliberately absent function name — returned the *same* verdict, so the pair proved
  nothing about the instrument. They now disagree: one reports deployed and callable, the other
  reports absent. A control that cannot yet tell two things apart looks identical to one that works,
  which is why that limit was written into the test file rather than left to be noticed. The same
  was true of `provision-member` on 2026-08-20, so it is a property of this design rather than an
  accident of either story.

  **Two corrections from 2026-08-24 are kept, because the count moved three times in one day.**

  The bullet said **THREE**, at a *predicted* 20 of 23, for about an hour. #95's session wrote the
  prediction under a stated caveat — that `check:live` could not run here for want of `.env.local`,
  so the count was arithmetic over the lists rather than a measurement. **The caveat was false**:
  the file exists, and had existed throughout. It was carried forward from a cairn note dated
  2026-08-21 without being checked, which is the ordinary way a status claim outlives its subject —
  *the note was accurate when written, and nothing about it announced that it had stopped being so*.
  The cheap lesson: **a claim that an instrument cannot be run is a claim about the environment, and
  it expires exactly like a claim about the project.** The cost of checking it was one command.

  It then said **TWO**, at a measured 21 of 23, and that was true when written and merged in PR #135
  — and false within hours, because the two owner actions it named were taken. That is not a defect
  in the sentence; it is what a correctly-written excused-red row is *for*. The defect would have
  been leaving it standing, because a stale excuse is indistinguishable from a live one, and it
  excuses precisely the two subjects most likely to fail next.

  **The hazard this form names is restated rather than dropped, for the sixth time.** An authority
  that is red by design and does not say so is one whose *next* genuine failure gets waved through.
  This page currently excuses **no** red at all: everything is new, real, and to be investigated
  rather than matched against a list. Each subject still has its own named test, so nothing can hide
  inside anything else.

  *This paragraph said "there is now **no** red this page excuses" until 2026-08-21, and it was
  true when written. It went false two paragraphs above where it sits, in the same edit that added
  the excused red — which is the failure mode of a correction that fixes the sentence about the
  subject and stops there. The repair is the one that costs nothing: after editing prose that
  states a value, grep the same file for the value.*

  *It said "exactly **one**" until 2026-08-24, and #95 found it by running exactly that repair —
  grepping this file for the value rather than for the subject. The count sat four screens below the
  bullet it belongs to, in a paragraph whose own subject is how a stale count gets waved through.
  Twice now the sentence about the hazard has been the thing carrying it.*

  *And it said "exactly **three**" for about an hour later the same day, which is the shortest-lived
  version yet. The value-grep worked again and is not the lesson; the lesson is that the grep was
  run against a count nobody had measured. **A correction sweep propagates whatever it is given** —
  it makes every copy agree, and says nothing about whether the agreed value is true. Running the
  instrument is a different act from synchronising the prose about it, and only one of them was done
  first.*

  *It said "exactly **two**" for about six hours after that — and this one is different in kind,
  because the sentence did not decay, **the world moved to meet it**. The queue it described was
  cleared by the two owner actions it named. A count that goes stale because somebody did the work
  is the good case, and the only thing it asks of this page is that the page be re-read after the
  work rather than only after an edit. Which is the argument for running `npm run check:live` when
  nothing in the repo has changed at all: on this page the subject moves without the file.*

  *And it was wrong a FOURTH time, for a few hours on 2026-08-26 — between #159's merge and the
  owner's paste that afternoon — for the one reason none of the three above covers: **nobody edited
  it.** #159 correctly added its excused-red row to the table four screens up and never touched this
  paragraph, so "excuses **no** red at all" went false with no edit, no diff and nothing to review.
  The paste then made it true again, by an action taken for its own reasons. Every correction above
  is about a sweep that reached some copies and not others; this one is about a copy no sweep was
  ever run for, restored by luck — which is worse, because **a claim that is true again by accident
  leaves exactly the same evidence as one that was never wrong.** The repair is the one this page
  keeps reaching from new directions: when you ADD a row to the excused-red table, grep this file
  for what it says about the set being empty before you close the editor. Adding a red is an edit to
  every sentence that counts them.*

  *The same pass found the two copies of the inversion COUNT disagreeing with each other. This page
  said the set had been inverted **seven** times; `README.md` said **eight**; neither cited the
  other, and both had been merged. The seven was checkable — this bullet enumerates its states, and
  there were seven transitions in the list — and the eight was not, because the README carries the
  number with no list beside it. #150 set both to **nine** by counting the enumeration and adding
  the two states of 2026-08-26, rather than by preferring whichever copy looked fresher. **A count
  with its derivation beside it and a count without one are not two opinions**: only one of them can
  be checked, and that is the one to propagate.*
- **RESOLVED 2026-08-20 — the `create_household` overload divergence, and the prediction that held.**
  Until `0007` was pasted, the live project carried `create_household(household_name, household_tz,
  organizer_name, organizer_pin)` — the four-argument version with the PIN — while the client since
  #62 called the three-argument one `0007` creates. Both are named `create_household`, so nothing
  that checked names alone could tell them apart, and the first run of #85's RPC check is what
  surfaced it on 2026-08-16. It shared one cause with the `members.email` red, which is why this page
  predicted **both would clear on the same paste** and why #108 was filed to check that rather than
  assume it. *Measured*: both cleared together. Kept rather than deleted because the mechanism is
  still live knowledge — PostgREST resolves an overload by its **set of argument names**, so a check
  written against names alone would have called this project healthy while every household creation
  in the app failed.

## Read this first — the decision below changed, twice

Two supersessions, and the second undoes an assumption the first was built on.

1. **2026-08-05 → 2026-08-06.** The original decision was *a household join code plus anonymous auth,
   pick yourself from the roster*. It was overridden in favour of **per-member credentials**: an
   organizer-set PIN on the member row, checked by the database.
2. **2026-08-06 → 2026-08-11 (#62).** That PIN scheme is now retired in favour of **real per-member
   auth users**, which is what the section below calls the upgrade path and explicitly does not
   reject on principle. Its stated blocker — *"the Supabase CLI is not installed, Docker is not
   running"* — is what changed, not the reasoning.

**What #62 actually changes**, in the order it matters:

- **`auth.uid()` is a PERSON, not a device.** `members.claimed_by` holds their auth user, and it is
  stable across time because a real credential returns the same user every session. That is what
  makes the whole thing possible.
- **`household_devices` is dropped.** It existed to absorb one hazard: an anonymous session expires
  after 30 idle days and returns with a *new* auth id, so a rarely-active member would have become a
  stranger to their own history. A stable auth id removes the hazard, so the table has nothing left
  to do. Membership now resolves through `public.current_household_ids()`, a `security definer`
  helper — necessary because a policy *on* `members` cannot subquery `members` without infinite RLS
  recursion, which Postgres refuses outright.
- **The join code is gone.** Not repurposed — dropped, along with `join_household` and
  `generate_join_code`. Admission is an account provisioned for one named person, so there is no
  shared secret to read out and nothing that works for whoever repeats it.

  **Partly superseded 2026-08-26** — see *"Decision taken 2026-08-26"* in
  [`refresh-charter.md`](refresh-charter.md). Admission gains a second route: an **invitation**, as
  a withdrawable single-use code and as an emailed link. The sentence above stays true in the part
  that mattered — there is still no shared household secret, because an invitation is created for a
  purpose, can be withdrawn, and is spent once. What changes is that provisioning is no longer the
  *only* way in. The names `join_household`, `generate_join_code` and `join_code` stay dropped and
  are not reused by the new mechanism.
- **PINs are gone as a database concept.** `pin_hash`, `has_pin`, `claim_member`,
  `claim_member_with_pin` and `set_member_pin` are all dropped, on this repo's rule that *a dead
  credential path which still works is a second way in*. A PIN can still be a person's password; the
  database no longer knows or cares.
- **`members.email` is the discriminator, and its nullability is the whole design.** A member with a
  real address signs in with it and carries a longer secret; a member without one gets a synthetic
  `<members.id>@taskr.invalid` address and a PIN. `.invalid` is reserved by
  RFC 2606, so a synthetic address can never reach a real inbox. There is deliberately **no separate
  `is_child` flag**, because a second field can disagree with the first.

  **Corrected 2026-08-28 (#242).** This read *"an address they never see or type"* until then, and so
  did `0007`'s own column comment, which now carries a dated correction beneath the original sentence
  rather than a rewrite — an applied migration is the record of what was decided on the day, and the
  sentence was an accurate statement of the intention at the time. *(Nothing mechanical required that:
  `migrate:live` md5s a file only to check the statement it is applying survived the wire, and `0007`
  is not applied again. The reason is editorial.)* It was never achievable. Sign-in
  is `signInWithPassword`, so the address is **half the credential** and somebody has to type it; there
  is no name-based lookup and there has not been one since #62 retired the join code. What made it
  invisible is that the sentence describes the MEMBER's experience and is false about the ORGANIZER's:
  the person handing the credential over has to read the address out, and nothing put it on a screen.

  Two consequences that are still true and worth keeping separate from the correction. A synthetic
  address really does reach no inbox, so the PIN travels by voice or text and nothing can be reset by
  email. And an address, once an account is minted at it, does not move: `provision-member` reads this
  column when it MINTS and refuses once `claimed_by` is set, so editing the roster afterwards changes
  who the row says the person is and not what they type. Re-pointing an existing account is a Supabase
  dashboard action.
- **`members.id` still does not move.** No history migrates. That was true before #62 and is the
  reason #62 was cheap — see *What it costs to change later*, which predicted this change and priced
  it correctly.

**Provisioning is DEPLOYED and live, since 2026-08-20.** Giving another person an account needs the
`service_role` key, so it needs the Edge Function — built by #87 (PR #92), deployed by
`npm run deploy:function` on 2026-08-20 (#112 AC 5), and proved from outside by `check:live`'s Edge
Function probe (#115), which is what the 20-of-20 bullet at the head of this page is reporting. An
organizer can add somebody to the roster and give them a sign-in, and that person signs in as
themselves. Since 2026-08-21 the live RLS suite exercises the whole path over the wire (#88): add a
member, provision them, sign in as them, and confirm the cross-household refusals still refuse.

*This paragraph said the deploy **"is owner-only and has not happened"** until 2026-08-21 — for a
day, while the header of this same page said `check:live` went green "immediately after
`npm run deploy:function`". PR #109 swept this document for exactly that claim and corrected the
sentences that named the function; these did not name it, so they survived. Two halves of one page
disagreed, and the stale half was the one in the section a reader opens to find out what is missing.
The step, and the check that proves it landed, are section 3 of `docs/deploy-runbook.md`.*

### Can an anonymous session exist here, and what could it reach? — #246

**No — `external.anonymous_users` is disabled on the live project** (owner decision 2026-08-28,
recorded with its post-state on #246). Nothing needs it: the app has signed a person in since #62,
and the last caller — `check:live`'s credential, which minted one permanent anonymous auth user per
run and accumulated **45** of them before #246 traced the count back to it — now signs in as the
seeded test account and revokes its session on exit. The decision is enforceable only in the
dashboard (it is a project setting nothing in this repo sets), so the repo-side guard is narrower
and real: `support/retiredVocabulary.test.js` scans both live suites and all shipping code with no
exemption for the sign-in call, in CI, on every push.

While the setting was on, what a memberless session could reach was *measured* rather than assumed
(#246): every policy on every `public` table is `to authenticated` and scoped through
`current_household_ids()` or `claimed_by = auth.uid()`, so a session with no member row read and
wrote **no household's rows** — but it could execute every function granted to `authenticated`,
including `create_household`, so anyone holding the world-readable publishable key could mint a
session and start an empty household. That is the standing hazard the flip closes: a policy whose
boundary is *being authenticated* is re-opened by every new way to become authenticated, and an
open anonymous provider is the cheapest way there is.

### Recovery, both directions — #62 AC 7 and AC 8

The story required these to be *decided and written down* rather than left to be discovered, so both
answers are here — and since 2026-08-20 both are live rather than one being "not yet".

**A member forgets their credential (AC 7).** The organizer resets it, and it still needs no inbox —
a synthetic `<id>@taskr.invalid` address has no mailbox to send a link to, by construction. The reset
is an admin password update, which needs `service_role`, so it lands with the Edge Function — built
by #87 (`provision-member`, action: `"reset"`; PR #92, merged 2026-08-13) and **deployed 2026-08-20**.
This is a genuine regression in capability against the PIN model, which could do
it with a plain RPC, and it is the price of a real auth identity rather than an oversight.

**The organizer loses their own credential (AC 8).** *The answer changed, and this is the change.*
Under the PIN scheme the answer was "a statement run in the Supabase SQL editor by whoever owns the
project" — because there was no address to mail. Under #62 there is: the organizer signs up with a
**real** email, which is required at household creation and is the one account in the household that
cannot be synthetic. So the answer is now **Supabase's own password-reset flow**,
`auth.resetPasswordForEmail`, with no bespoke recovery path and nobody needing dashboard access.

Two things that are deliberately true and worth stating rather than implying:

- **The UI for it is not built.** The mechanism is standard and needs no server, but until a "forgot
  your password" link exists an organizer would have to trigger it from the dashboard. That is a
  smaller gap than the old answer, and it is still a gap.
- **The organizer is still the root.** There is nobody above them to authorise anything; what changed
  is that they can now prove who they are to Supabase instead of to a person with database access.
  That is acceptable for a household app and would not be for anything else.

### What removing a member does to their account — #247

**Removal deletes the auth account too, when the account is theirs alone.** Until #247 it did not:
`removeMember` was a plain delete on `public.members`, nothing anywhere deleted the auth user, and the
result was an account with no member row that could still sign in and start a household of its own —
one such orphan was found on the live project, minted for a member row that no longer exists. Row-level
security held throughout (a memberless session reaches no household's rows), which is why that was a
defect and not an incident.

The rules, in the order the client runs them:

- **The auth half goes first**, through `provision-member`'s `revoke` action, under the same
  caller-scoped authorization as minting: the member is read through the caller's own JWT, the
  organizer check is asked about the household on that member's row, and only then is `service_role`
  touched. Auth-first is the recoverable order — `members_claimed_by_fkey` is `ON DELETE SET NULL`, so
  a removal that dies between the halves leaves a member showing "No sign-in yet", a state the roster
  renders and Give a sign-in repairs. Row-first would leave the orphan.
- **The account is deleted only when this row is its last claim.** Since 0009 one person can hold
  member rows in two households under one account, so the function first checks (as `service_role`,
  necessarily — the caller cannot see other households) whether any other member row claims it.
  Claimed elsewhere, the account survives and only this household's row goes: the other household's
  access was never this organizer's to end. The same rule covers a member with a real email address —
  the account was minted for the member rows that claim it, and when the last claim goes, what is left
  is a key to nothing plus the power to start a household.
- **A member with no sign-in never touches the function.** The row is deleted through RLS
  (`members_delete_same_household`, 0016) exactly as before, so removal keeps working when the
  function is unreachable.
- **A failed revoke does not stop the removal.** The person is removed and the screen says both facts
  separately — removed from the household, account NOT deleted — so nobody concludes the removal
  failed and retries. The removal is deliberately not held hostage by the function: were removal to
  abort on an unreachable function, an organizer could not remove anybody with a sign-in until
  somebody redeployed it.

## Superseded: the PIN decision — 2026-08-06

**Kept for the record. This is no longer what the app does — see *Read this first* above.** Retired
by #62 on 2026-08-11. It is left in full because its reasoning is still the reason the schema has the
shape it has, and because the section immediately below — *why not real per-member auth users* — is
the argument #62 had to answer rather than one it ignored. It answered it by removing the premise:
the Edge Function that was unavailable is now the plan — and has since shipped: `provision-member`
is deployed and mints exactly those accounts, so the "this app has no server" premise below is the
one clause of the record that is no longer true of the app.

**An organizer-set PIN, carried on the member row, checked by the database.**

A device still signs in anonymously and still joins with the household code. On top of that, claiming
a person — saying "this is me" — requires that person's PIN.

### Why not real per-member auth users, which is what "credentials" sounds like

Because an organizer cannot create another person's Supabase auth user from a browser, and this app
has no server:

- `supabase.auth.signUp()` signs the caller in **as the new user**. An organizer creating accounts
  for three children would be signed out of their own after the first.
- `auth.admin.createUser()`, and resetting somebody else's password, both need the **service_role**
  key. That key bypasses row-level security entirely and must never reach a client bundle — this repo
  already fails the build if it does.

So the literal reading of "the organizer creates each member's credential" requires a privileged
server-side component: a Supabase Edge Function holding the service key. That is a real option and it
was rejected **for now**, not on principle — the Supabase CLI is not installed, Docker is not
running, and deploying one is an owner-only step. It is the upgrade path, and it is cheap; see *What
it costs to change later*.

The two alternatives that avoid a server were weighed:

- *Member self-signup with a synthetic email, gated by the join code.* Gives each person a genuine
  Supabase identity with no admin API. Rejected because **password reset still needs admin** — so it
  defers precisely the half of the problem the owner asked to settle, and a forgotten password ends
  in an Edge Function anyway.
- *One shared account.* Loses attribution, which #7 and #12 both depend on. Rejected in the original
  decision and still rejected.

## The honest security level — AC 4

**A PIN is a credential for telling household members apart. It is not a defence against an
attacker.** Stated plainly, because the whole point of writing this down is that nobody later mistakes
it for one:

- **The PIN separates people inside a household. The join code is what keeps strangers out.** Neither
  is strong. A child who reads the join code out on a school bus has given away household access, and
  no PIN changes that.
- **There is no rate limit on `claim_member_with_pin`.** A four-digit PIN is 10,000 possibilities and
  a determined sibling with a script would get through. What makes this tolerable is the threat model
  — the attacker is a nine-year-old who wants to mark someone else's chores done — and what makes it
  *fixable* is that the check is server-side, so a rate limit is a change to one function.
- **What it does buy, and it is not nothing:** the PIN hash is bcrypt and is **never readable by any
  client**, so it cannot be attacked offline; a member cannot set their own PIN, so a child cannot
  lock a parent out; and taking someone's identity now requires their PIN rather than one line of
  JavaScript.

That last clause is not hypothetical. Before migration 0002, `claim_member()` refused a second device
correctly **and a direct `update members set claimed_by` succeeded anyway** — measured against the
live project on 2026-08-06. The guard was real and optional, which is the same as absent.

### The part that is doing the work: column grants

Row-level security decides **which rows**. It has nothing to say about **which columns**, and
Supabase grants `authenticated` every column by default. So every rule expressed as "call this
function" was advisory until 0002 revoked the columns:

- `claimed_by` and `pin_hash` are no longer writable by any client, through any path.
- `pin_hash` is not **readable** either. `select('*')` on `members` now fails outright rather than
  quietly omitting it — which is why the app selects an explicit column list.
- `has_pin` is a generated boolean, granted, because the UI has to know which sign-in to offer
  without being told the secret.

## Credentials for a person with no email, and who resets them — AC 5

- **The identifier is the member row**, not an email address and not a username. Nothing anywhere
  asks a child for an email, because the app never creates an auth user for them — `auth.uid()`
  identifies the *device*, and the PIN proves which *person* that device is acting as. This is the
  main reason the PIN approach was chosen over synthetic-email signup: the honest answer to "what is
  a nine-year-old's identifier?" is *"their name on the roster"*.
- **The organizer sets the PIN**, at household creation for themselves and per person afterwards.
  Enforced by `is_household_organizer()` in the database, not by hiding a button.
- **The organizer resets a forgotten PIN.** There is deliberately **no self-service reset**: there is
  no inbox to send a link to, and a "security question" for a child is theatre. A reset also
  **releases whichever phone is currently acting as that person**, so a forgotten PIN and a phone
  handed on to a sibling are the same operation.
- **The organizer is a person, not a session.** `households.organizer_member_id` points at a member
  row, and a device is the organizer exactly while it is claiming that row. Keying it to `auth.uid()`
  would have quietly disenfranchised the organizer after 30 idle days, when the anonymous session
  expires and returns with a new id — the same trap `members.claimed_by` exists to avoid.
- **The organizer's own PIN cannot be recovered.** They are the root of this scheme; there is nobody
  above them to authorise a reset. The onboarding screen says so at the moment the PIN is chosen.
  Recovering from a lost organizer PIN means a statement run in the Supabase SQL editor by whoever
  owns the project — which is the owner, which is the same person. That is an acceptable answer for a
  household app and would not be for anything else.

## What it costs to change later

**This section was written on 2026-08-06 as a prediction, and #62 is the change it predicted. It is
worth reading against what actually happened, because it was right about the expensive part and
incomplete about the rest** — which is the more useful kind of record than one quietly corrected
after the fact.

Right: no data migration, `members.id` unmoved, `pin_hash` dropped, the whole thing cheap for exactly
the stated reason. What it did not name:

- **Four `security definer` functions carried the old predicate in their bodies** —
  `complete_chore`, `uncomplete_chore`, `assign_chore`, `unassign_chore` all joined
  `household_devices`. A plpgsql body resolves its tables at call time, so dropping the table raised
  nothing and the migration reported success; every one of those actions would have failed on its
  first call in production. Re-pointing policies is visible work and re-pointing function bodies is
  not.
- **Dropping `household_devices` reintroduces the RLS recursion it was accidentally absorbing.** A
  policy on `members` whose predicate subqueries `members` is refused outright by Postgres, so the
  change needs a `security definer` helper it is easy not to see coming.
- **The one-time re-claim is not re-runnable**, and every other file here is — **re-applied in
  order**. A single older file re-pasted on its own onto a schema that has moved past it is a
  different question, and the answer is *no* for more than the pre-`0007` files the next bullet
  measures: since `0025`, any file that carries its own body of a function a later file replaced
  reverts that function when re-pasted alone, with the paste reporting success — today `0012`,
  `0025` and `0026`, each carrying a `catch_up_repeats_at` that `0028` superseded (*measured under
  #306, three arms in `superseded.pglite.test.js`*), and, since `0029`, **`0027` and `0007`**, which
  carry the `complete_chore` and `uncomplete_chore` bodies `0029` superseded (*measured under #307,
  two arms in `completion-assignment.pglite.test.js`, each with a before/after control in one run*).
  Re-pasting `0027` alone takes the completion-assigns-the-completer rule away; re-pasting `0007`
  takes it away too, because that file carries **both** functions — a prediction that only the undo
  half would go was written into the test and **falsified by running it**, which is why the arm
  exists. `check:live` cannot see a function body, so the reversion is silent to it too; the repair
  is re-pasting the newest file. *(This bullet read "every other file here is" with no qualifier
  until 2026-09-02.)* Clearing `claimed_by`
  is correct exactly once; a second paste clears the identities the Edge Function has since written
  and locks the household out with no client-side recovery.
- **AND NEITHER IS ANY PRE-`0007` FILE, RE-PASTED ON ITS OWN, ONTO TODAY'S SCHEMA** — which is a
  narrower claim than the bullet above and a wider hazard. *Measured 2026-08-28 under #38*, on a
  pglite database carrying `0001`–`0021` and then handed one older file again:

  | file | apply | what it leaves |
  |---|---|---|
  | `0003_chores.sql` | **FAILS** — `relation "public.household_devices" does not exist` | its five `chores` policies still name the dropped table; rolled back |
  | `0004_chore_completion.sql` | **succeeds, silently** | `complete_chore` and `uncomplete_chore` revert to the retired model, and the next authenticated call raises `relation "public.household_devices" does not exist` |
  | `0005_weekly_capacity.sql` | **FAILS** — same | rolled back |
  | `0006_chore_assignment.sql` | **succeeds, silently** | `assign_chore` and `unassign_chore` revert the same way |

  Both silent cases were proven end to end with a before/after control in one run: the RPC worked
  before the re-apply and raised after it. The two that fail are the safe ones. **`0005` is the
  worst of the four if its policies are ever satisfied**, because it also drops the live
  three-argument `create_household` and installs a four-argument one whose body calls
  `assert_valid_pin` and `generate_join_code` and writes `household_devices` and `members.pin_hash`
  — all of which `0007` removed.

  What is re-runnable is what `migrations.pglite.test.js` actually asserts and CI actually runs:
  **the whole list, in order**. That is also the only re-run anybody has a reason to perform, and
  `databaseThrough`'s docblock in `support/pgliteSupabase.js` has said so since it was written. This
  bullet exists because #38's AC 1 asked for the other thing — each chore file pasted a second time
  against the live project — and nothing in the repo said out loud that it must not be.

Deliberately little, and the schema is why:

- **Upgrading to real per-member auth users** is an Edge Function plus a sign-in change. No data
  migration: `members.id` is still the durable person and every later story references *that*.
  `pin_hash` becomes dead and is dropped.
- **Adding a rate limit** to `claim_member_with_pin` is a change to one function, because the check
  already happens in the database rather than in the client.
- **Adding a second organizer** is a column change, not a redesign — `organizer_member_id` would
  become a role on the member row.

The thing that would have made all of this expensive is attribution keyed to the auth id, and the
schema deliberately does not do that.

## Superseded: the original decision — 2026-08-05

**Kept for the record. This is no longer what the app does — see *The decision* above.** It is left
here in full because the reasoning still explains the shape of the schema, and because a decision that
was made, acted on and then reversed is worth being able to read.


**A household join code, plus device-level anonymous authentication, plus pick-yourself from the
roster.**

The alternatives, and why they lost:

- *Parent-created credentials per member* — real identity and no session-expiry surprise, but it puts
  a forgotten-password surface in front of a nine-year-old and collects more about each person than
  the app needs. Rejected on friction at exactly the moment five phones are being onboarded.
- *One shared account on every phone* — trivially simple, and it loses attribution. That is not a
  cosmetic loss: the expected-vs-actual story (#12) and the load view (#7) both need to know who did
  what. Cheapest now, most expensive to unpick later.

`docs/hosting-decision.md` had already confirmed the prerequisite this decision rests on — anonymous
sign-ins are on Supabase's free tier and convert to a real account later **keeping the same user id**.
That confirmation was a precondition #5 named explicitly, and it was checked rather than assumed.

## The honest security level — AC 7

**A shared join code is deterrence, not defense.** It is a bearer credential: anyone holding it is in.
It does not expire, it cannot be revoked per-person, and a child who reads it out on a school bus has
given away household access. What it does buy is that household data is not world-readable, which is
a real and sufficient improvement over the shell that preceded it.

Specifically, with the code, an attacker gets read and write access to that household's roster. Without
it they get **nothing** — not an empty household, not a count, not an error that distinguishes "wrong
code" from "no such household". That last point is deliberate: `join_household` raises the same
message either way, because telling a guesser which of the two they hit is free information.

The code is 8 characters from a 30-symbol alphabet — about 6.6 × 10¹¹ combinations — with `0/O`,
`1/I/L` and `U` excluded because they are misread when read aloud. There is **no server-side rate
limit on join attempts** beyond Supabase's platform defaults, so the arithmetic above is the whole of
the protection. If that ever stops being enough, the fix is a rate limit on `join_household` or a code
with an expiry, not a longer code.

**What upgrading to per-member auth would cost later.** Deliberately little, and that is why this was
a safe choice rather than a cheap one:

- Anonymous users **convert in place, keeping the same user id**, so a member who later gets an email
  keeps their history without a migration.
- Nothing in the schema references `auth.uid()` as an identity. `members.id` is the durable person and
  every later story references *that*. `members.claimed_by` is only ever "which device session is
  currently acting as this person".
- So the upgrade is an auth-flow change plus a UI change, and **no data migration**. The one thing that
  would make it expensive — attribution keyed to the auth id — is the thing the schema deliberately
  does not do.

That last point is not tidiness. Anonymous sessions expire after **30 days of inactivity** and the user
comes back with a **new auth id**. A rarely-active family member would silently become a stranger to
their own history if membership were keyed to the auth id, and it would not show up for months.

## How the rules are enforced

Everything is in `supabase/migrations/0001_household_and_roster.sql`. Row-level security is on for all
three tables with no permissive fallback.

- `household_devices` is the root: a session may read its own membership row and nothing else. Every
  other policy reads through it.
- `households` and `members` are visible only to a session that has joined that household.
- A household is a **trust boundary**: inside it, anyone may maintain the roster. There is no
  parent/child distinction, because the charter's bar is a household tool and not an admin console.
- There is **no insert, update or delete policy on `households` or `household_devices` at all**. Those
  rows are created only by `create_household` and `join_household`, which run as definer. A client
  cannot mint a household, forge a membership, or rewrite a join code by any path, because no policy
  exists that would permit it.
- `claim_member` takes `FOR UPDATE` on the member row, so two phones racing to claim the same person
  serialise and the second is refused, rather than both reading "unclaimed" and both writing.

The anon key is inlined into the client bundle at build time and is readable by anyone who views
source. **It is publishable only because these policies exist.** The `service_role` key bypasses RLS
entirely and must never appear in the front end, in git, or behind any `VITE_` variable.

> **This rule was broken, 2026-08-05, and the build now enforces it.** `VITE_SUPABASE_ANON_KEY` in
> Vercel was set to a `sb_secret_…` key — the current-generation equivalent of `service_role` — and it
> shipped into a world-readable preview bundle. Nothing failed, because *nothing can*: a secret key
> bypasses RLS, so the app works perfectly and every policy above is silently void.
>
> The variable lives in a hosting dashboard, outside this repository, so no test, review or grep of
> the codebase could have caught it. `src/lib/keyShape.js` is therefore checked at **build** time from
> `vite.config.js`: a secret key fails the build on the provider's own builder, which is the last
> point at which it can still be stopped. `src/lib/supabase.js` repeats the check at runtime for a dev
> server, where no build happens.
>
> *Proven by making it refuse*: a `sb_secret_…` key and a legacy `service_role` JWT both exit `1`,
> while a `sb_publishable_…` key and an unconfigured build both exit `0` — the last two matter most,
> since a guard that always failed would be indistinguishable from one that works.
>
> **If a secret key has ever been built, rotate it.** Fixing the variable and redeploying does not
> invalidate what was already published.

## The test that bypasses the client — AC 6

`src/test/rls.integration.test.js` talks to Supabase over the wire with the anon key, exactly as a
stranger with the published bundle would. It imports nothing from `src/` except the join-code helper;
going through the app's own data layer would test the app's manners rather than the database's rules.

It is **excluded from `npm test`, and therefore from CI**, because CI has no Supabase credentials. The
exclusion is recorded in three places on purpose — `vite.config.js`, the test file's own header, and
here — so that someone counting the gate's checks does not read four as five.

It is excluded rather than made to skip. A security test that quietly passes when unconfigured is the
same defect `docs/ci-gate.md` exists to prevent, so this one **throws** when the credentials are
missing. *Verified*: `npm run test:rls` without `.env.local` exits `1` with a message naming what is
absent and why the file is not in CI.

It also carries a **positive control** — an assertion that device A, which created the household, can
see its own roster. Without it, every "device B sees nothing" assertion would be satisfied by a
database that returns nothing to anybody, including one with a typo in the table name, and the suite
would read as proof of security.

## Running it

Prerequisites, all in the Supabase dashboard and all the owner's:

1. **Apply the migration.** Paste `supabase/migrations/0001_household_and_roster.sql` into the SQL
   editor and run it. (There is no Supabase CLI on this machine, so there is no `supabase db push`.)
2. **Create the seeded test account**, once — Authentication → Users → Add user → Create new user,
   with **Auto Confirm User** ticked. Both live suites sign in as it; `.env.example` carries the
   recipe and the warning about what a tidy-up must spare.
3. Put the project URL, the **anon** key, and the seeded account's credentials in `.env.local` at
   the repo root (gitignored):

   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   TASKR_TEST_EMAIL=...
   TASKR_TEST_PASSWORD=...
   ```

Then `npm run test:rls`.

*(Step 2 said "Enable anonymous sign-ins" until #246, and a rate-limit paragraph stood here pricing
30 anonymous requests/hour. Both are gone with the mechanism: no suite signs in anonymously any
more, and the provider is disabled on the live project — see the #246 section above.)*

**Cleanup.** Each run leaves, on the live project, **two** households named `TEST 88 <timestamp> ...`,
five member rows, and two auth users — the two provisioned members, whose addresses are
`<members.id>@taskr.invalid`. There is deliberately no client-reachable way to delete a household, so
tidying is a manual statement in the SQL editor:

```sql
delete from public.households where name like 'TEST 88 %';
```

*(Corrected 2026-08-28 by #221. This said one household and two ANONYMOUS users, which was the
device-auth era: #88 moved the suite to per-member sign-in on 2026-08-21 and the suite's own header
recorded the new figures that day. The correction reached the suite and not this page, which is the
document a person tidying up actually opens. Five member rows, not four — the fifth is created by a
test body rather than by `beforeAll`, so a count derived by reading setup cannot see it.)*

> **A tidy-up must SPARE the account behind `TASKR_TEST_EMAIL`.** Read the paragraph above once more
> before running anything: the seeded account **organizes every `TEST 88` household**, so since `0009`
> it holds a member row in each one. The `delete` shown here cascades to those member rows and leaves
> the account itself standing — but a tidy-up that *also* clears the test auth users takes the seeded
> account with them, because from inside the data it is indistinguishable from the residue it creates.
>
> That has happened once. The account was cleared around **2026-08-25** and `npm run test:rls` could
> not reach its first assertion for four days. It cost more than the rows implied, for two reasons.
> **`test:rls` is the only instrument that has ever confirmed `0009` reached the live project** —
> `check:live` is structurally blind to a migration made only of indexes, and this page says so above.
> And **nothing announced the loss**: a vitest `beforeAll` failure is reported as tests *skipped*
> (`numFailedTests: 0`, `success: false`), so the run exits non-zero with nothing named as failing,
> which reads as an environment hiccup rather than as a dead suite. Two tests then drifted out of date
> unseen inside that window and only surfaced when the account was restored.
>
> **To restore it:** Authentication -> Users -> Add user -> Create new user, tick **Auto Confirm
> User**, using the exact values already in `.env.local`. Confirm it from the catalog rather than from
> the dashboard's user search — that search has been observed returning *"No users found"* for an
> address present in the unfiltered list seconds earlier, so it cannot prove an absence.

## What is not done

### Correction, 2026-08-09 — this section was wrong in both directions at once

**Every migration below is now applied.** The entries are kept because their *reasoning* is still
the best record of what each file does and why; only their status claims were wrong. Read them for
the design, never for what the live project has.

What happened: pasting `0006` at the merge of #36 was rejected with
`ERROR: 42P01: relation "public.chores" does not exist`. **`0003` and `0004` had never been
applied**, though #34 and #35 merged on 2026-08-08 and deployed client code that reads those tables.
For a day the live app could not hold a household at all — `refresh()` calls `listChores()` whenever
one is found, so a joined device failed at boot and creating a household failed immediately. All
three were then applied in order: `0003`, `0004`, `0006`.

Meanwhile the `0005` entry claimed the opposite of the truth: it had been live since #45, and
applied cleanly without `chores` existing because it only touches `households`, `members` and
`member_capacity`.

**So this page was right about two migrations, wrong about one, and load-bearing for neither** —
nothing reads it. That is the actual defect, and it is filed as
[#78](https://github.com/SailorDave17/Taskr/issues/78): a required deploy step performed by a human,
recorded only in prose, and compared against nothing. Note why no test caught it — the pglite
harness applies every file in `supabase/migrations/` **from disk**, so a green suite proves the
schema is right in the one environment where it cannot be wrong, and `npm run test:rls`, the only
thing that goes over the wire, contains zero references to `chores`.

**#78 landed 2026-08-10, and the authority moved off this page.** `npm run check:live` probes every
table and column the client reads, using the same column constants the queries use, and fails naming
the missing object — `42P01` for a table a migration never created, `42703` for a column `0004` or
`0006` would have added, `42501` for something present that this role may not read. It reads schema
and never data (`limit(0)`), so it is safe to run against production at any time, and it refuses a
secret key, which would answer a different question with broader grants.

One limit remains, stated rather than discovered later: it is **not run by CI** — CI has no
credentials, and a check that skips itself when unconfigured is the vacuous pass this whole story is
about — so it is a step a human runs after pasting a migration. The *list* it works from is guarded
in CI by `src/lib/liveSchema.test.js`, which fails when the app reads a table the list does not name.

**The second limit closed with #85, 2026-08-16.** It used to cover *tables, not functions* — `0006`
adds `assign_chore` and `unassign_chore` as well as a column, so a migration that added only an RPC
would pass the check while the app failed. `check:live` now probes the five RPCs the client calls as
well, **by their argument names**, because PostgREST resolves an overload by the set of argument
names rather than by position: `create_household(household_name, organizer_name,
household_timezone)` and `create_household(household_name, household_tz, organizer_name,
organizer_pin)` are two different functions to it. Until the `0007` paste on 2026-08-20 only the
second was on the live project while the client called the first — which is precisely the divergence
this probe was built to catch, and it caught it on its first run.

How a function is probed without calling it is the part worth carrying: the probe is a **GET**, and
PostgREST serves a GET inside a **read-only transaction**. All five of these RPCs write, so Postgres
refuses the write and answers `25006` — which proves the function resolved *and* proves nothing
changed, in one round trip. It is the function-shaped equivalent of `limit(0)`, and the check asserts
that read-only behaviour with a control of its own rather than trusting it. A `PGRST202` is the
failure: PostgREST answered from its schema cache, so the function was never resolved.

#85 was filed naming **nine** RPCs and the answer is **five**. That is not a narrowing: `0007` drops
`claim_member`, `claim_member_with_pin`, `set_member_pin` and `join_household`, and the client
stopped calling them at #62 — so probing for them would make the check red against a *fully migrated*
project, which is the `household_devices` mistake in the other direction.

This section remains a **reasoning record, not a status report** - read the entries below for what each migration does and why, and `npm run check:live` for what the project actually has.

### Updated 2026-08-09 — story #36 added a sixth migration

**`0006_chore_assignment.sql` was applied 2026-08-09**, at the merge of #36, third of the three
pasted that day. It had to go last: it alters the table `0003` creates. Its paste also settled a
question no local test could — **Supabase accepts `on delete set null (assigned_member_id)`**, the
Postgres 15+ column-list form, which until then was proven only against PGlite 18.

Pasting it mattered for the same
reason 0003 and 0004 must be: the merge deploys client code that reads `assigned_member_id`, the
chore read shares `refresh()` with the roster, and a column a `select` list names but the project
does not have fails the whole shell rather than just the chore list.

What it adds, and the two decisions worth knowing before pasting:

- **`assigned_member_id` is readable and NOT writable**, arriving withheld rather than revoked from a
  shipped write path. It moves only through `assign_chore()` / `unassign_chore()`. This is the third
  application of 0003's additive-by-column convention and the reasoning has not changed: a
  client-writable assignment column makes the eligibility rule (#37), the churn bound (#41) and every
  allocator invariant (#40, #49) advisory rather than enforceable.
- **The same-household rule is a CONSTRAINT, not only a function check** — and this is the first
  migration here to do that. The foreign key is composite,
  `(assigned_member_id, household_id) → members (id, household_id)`, so a chore in one household
  cannot name a member of another even for a caller who bypasses the function entirely. That is this
  page's own central lesson applied to itself: *a rule enforced only inside a function you provide is
  enforced only for clients that choose to call it.* `assign_chore` still refuses first, because AC 1
  wants a sentence rather than a constraint violation; the constraint is what keeps the rule true if
  the function is later edited wrongly.
- **`on delete set null (assigned_member_id)` names its column, and the clause is load-bearing.** A
  bare `on delete set null` on a composite key nulls *every* referencing column, and `household_id`
  is `not null` — so removing a member would fail with a constraint violation instead of releasing
  their chores, which is the exact inverse of what #36 AC 7 asks for. *Measured* by mutation:
  dropping the column list reddens AC 7 and nothing else. Postgres 15+, which both PGlite 18 and
  Supabase satisfy.
- **Nothing is stored.** Committed and remaining minutes are summed at read time in
  `src/lib/chores.js`; the migration adds one column holding the allocation and no counter. A
  `members.committed_minutes` would be two sources for one quantity and they would disagree the first
  time a chore was completed on another phone — so the suite asserts the *absence* of any such column
  across the whole `public` schema, not merely the presence of the sum.

### Updated 2026-08-08 — story #35 added a fourth migration

**`0004_chore_completion.sql` was applied 2026-08-09** — *four days after the merge of #35, not at
it*, which is half of the outage described in the correction above. Second of the three pasted that
day. It had to be pasted for the same
reason 0003 must be — the merge deploys client code that reads `completed_at`, and the chore read
shares `refresh()` with the roster, so the whole shell fails rather than just the chore list.

What it adds, and the one non-obvious decision:

- **`completed_at` and `completed_by_member_id` are readable and NOT writable.** They move only
  through `complete_chore()` / `uncomplete_chore()`, and the withholding is in place from the first
  moment the columns exist rather than revoked from a shipped write path later.
- **The definer function is about the CLOCK, not access control.** A household is already a trust
  boundary, so the function buys no authorization it did not have. What it buys is `now()` being the
  *database's*: `completed_at` decides which week work falls in, and a phone with a wrong date would
  move work between weeks silently. That is a foreign input to the fairness arithmetic.
- **Attribution is to `members.id`, never `auth.uid()`** — the invariant 0001 sets. An idle
  anonymous session returns after 30 days with a new auth id.
- **Completing an unassigned chore is allowed and attributed** (owner decision, 2026-08-08). It is
  the noticing dimension's first contact with data; nothing surfaces it, and whether it ever becomes
  a product feature stays open.

### Updated 2026-08-08 — story #34 added a third migration

**`0003_chores.sql` was applied 2026-08-09** — *five days after the merge of #34*, and it is the
missing one that broke the live app. First of the three pasted that day. It creates `chores`, the
fourth RLS-protected table, and the instruction below was correct and was not followed: it must be
pasted into the Supabase SQL editor **at the merge of #34, not afterwards** —
the merge deploys client code that queries a table the live project does not have, and the failure
is total rather than confined to the chore list, because the chore read sits in the same `refresh()`
chain as the roster. Nothing in the repo enforces this; that is why it is written here, on the page
that lists what is outstanding, rather than only in the issue.

It follows 0002's revoke-then-grant-per-column shape and adds two things worth knowing:

- **`household_id` is withheld from the select grant**, which is what makes `select('*')` fail on
  this table. *Measured*: with every column granted the wildcard succeeds, so a table whose every
  column is readable has the ceremony and none of the effect. A withheld column is also absent from
  `WHERE` and `ORDER BY`, not just the projection — fine here, because RLS is the filter.
- **`anon` is revoked wholesale** (`revoke all`), not column by column. An earlier draft revoked only
  select/insert/update and left DELETE, TRUNCATE and TRIGGER granted by Supabase's defaults; neither
  was reachable through the publishable key, but the DELETE grant would have gone live the moment a
  later story added a `to anon` policy. `authenticated` keeps DELETE, which its policy needs.

The convention #35, #36 and #37 inherit: each migration grants UPDATE only on the columns it makes
client-editable, so `assigned_member_id` and `completed_at` do not exist yet.

### Updated 2026-08-06 — story #23, and what is left

`0001` **is** applied and anonymous sign-ins **are** on *(true on the day this entry was written;
anonymous sign-ins were disabled 2026-08-28 by #246, nothing needing them any more)*; the sentence
below about "the migration has not been applied" is about 0001 and is now historical. What is
outstanding is narrower:

- **`0002_member_pins_and_column_grants.sql` — now applied**, verified live by PR #65's suite; the
  rest of this bullet is historical. It is re-runnable, and a test asserts that it is, because a re-paste after a partial failure
  is the normal way this file gets used.
- **It changes `create_household`'s signature** from one argument to three, and drops the old form
  deliberately — a household created without an organizer cannot be administered at all. So the
  deployed bundle and the database must move together: applying 0002 breaks the currently-deployed
  app until this PR's build is live, and vice versa. On a household app with no users yet that is a
  non-event; it will not be later. **0005 takes it to four**, adding the household timezone with a
  default, so that fourth argument is the one signature change so far that does *not* break an older
  bundle — a three-argument call still resolves.

- **`0005_weekly_capacity.sql` was applied at #45**, and this entry claimed otherwise until
  2026-08-09 — the wrong direction of the same defect. #45 owns the paste and proving the rules over
  the wire, and did both. It adds `member_capacity` — a
  per-member, per-week override on top of the `members.weekly_minutes` baseline — plus
  `households.timezone`. Three things about it are worth knowing before pasting:

  - **The week begins on Monday**, enforced by a check constraint rather than left to convention, so
    a row filed under any other weekday cannot exist. Reasoning in
    [`capacity-model.md`](capacity-model.md).
  - **`household_id` is withheld from the select grant**, same convention as `chores` in 0003 — which
    also means it cannot appear in a `WHERE` clause, because Postgres requires `SELECT` on any column
    named in a predicate and reports the refusal as *"permission denied for table"*.
  - **`households` gains its first `UPDATE` policy**, so that surface is column-granted to
    `name, timezone` only. Without that bound, any member could rewrite `join_code` or reassign
    `organizer_member_id` — the hole 0002 measured, reopened. **`SELECT` on `households` is
    deliberately left un-granted-per-column**: `currentHousehold()` issues `select('*')`, which a
    column grant makes fail outright.
- **The existing test households are unusable under 0002.** They have no `organizer_member_id`, so
  `is_household_organizer()` returns false for them and no PIN can ever be set. They are `TEST …` rows
  and the cleanup statement in *Running it* removes them.
- **Nothing here has been verified on two real phones.** That is #26, deliberately.

Unlike the previous rounds, the SQL in this story **has** been executed before being handed over —
`src/test/migrations.pglite.test.js` runs 0001 and 0002 against Postgres 18 in WASM, with 22
assertions and a mutation record, and `src/test/chores.pglite.test.js` does the same for 0003. That proves it is correct Postgres and that the rules hold; it does
not prove Supabase will accept it, and the stub it runs against is listed in
`src/test/support/pgliteSupabase.js` so the gap is inspectable.

### Historical — written at PR 1 of story #5

- **The migration has not been applied to the live project**, so none of the policies above have been
  exercised against a real Postgres. The SQL is unvalidated in the strict sense: there is no local
  Postgres, no Supabase CLI and no running Docker daemon on this machine, so nothing has parsed it.
  Applying it in the dashboard both validates it and unblocks the test — one action, and it is the
  reason this PR ticks no acceptance criteria.
- ACs 1–5 are PRs 2 and 3 of this story: the roster UI, persistence across restarts, and the join flow
  verified on two real phones.

### Updated 2026-08-05 — PR 2 (the roster UI) has landed

The client half of ACs 1–5 is now built: `src/lib/household.js` plus `src/components/Onboarding.jsx`
and `src/components/Roster.jsx`, with 100 unit and component tests (was 30) and five mutations each
reddening exactly the predicted test.

**No acceptance criterion is ticked by that PR either, and the reason has not changed.** Both prerequisites
above are still outstanding, so nothing in this story has run against a real database:

- the migration is still unapplied, so the policies remain unparsed;
- anonymous sign-ins are still off, so no device can obtain a session at all.

Until both are done, every ACs 1–6 check fails at the first round trip. What the tests above *do*
establish is narrower and worth stating precisely: the app asks the right questions, refuses the
obviously wrong ones before spending a round trip, and reads the roster from the server rather than
from device storage. **None of that is evidence about the access rules** — a fake client returns
whatever the test told it to. AC 6 is `src/test/rls.integration.test.js` and nothing else.

One client-side design note that belongs here rather than in a commit message: the app holds the
Supabase **auth session** locally and nothing else. That session is the credential, which is what
makes AC 5's "stays joined days later without re-entering the code" true; the household and roster are
re-read from the server on every load, so a device that merely *remembered* would be indistinguishable
from one that is genuinely still joined — and AC 3 is precisely the check that would be fooled.
- **Preview deployments are login-gated** — Vercel Authentication is set to *Standard Protection*,
  applied 2026-08-21 by #121. A preview URL now answers `302` to `vercel.com/sso-api` and lands on
  `vercel.com/login`; an unauthenticated stranger cannot load the app, and cannot fetch its bundle
  either. Until then previews were world-readable while carrying the PRODUCTION Supabase host, which
  is what made a preview a second front door onto the live database rather than a sandbox, and is the
  surface #19 decided to close.

  **What Standard Protection exempts is the production *domains*, not production deployments** —
  measured 2026-08-21 on uncached paths, in the same second: `taskr.madcowhq.com` and the assigned
  `taskr-khaki.vercel.app` both reach the app, while **every** per-deployment `*.vercel.app` URL
  redirects to login, the production deployment's own URL included. #121 was filed expecting the
  assigned domain to be gated too, on the strength of Vercel's documented wording; it is not. Nobody
  was locked out and no re-install was forced.

  This gates the client, not the data. It removes an unwatched surface and changes nothing about who
  can read a row: the policies on this page held the line before it and remain the whole defence
  after it.
