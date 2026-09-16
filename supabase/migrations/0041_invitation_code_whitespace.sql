-- A pasted invitation code survives its own whitespace — story #173, AC 8.
--
-- `0040` normalises a code with `lower(btrim(code))` before hashing it, and
-- `btrim` with ONE argument trims SPACES ONLY: its character set defaults to a
-- single space, so a tab, a newline or a carriage return at either end
-- survives into the digest. *Measured 2026-09-10* in pglite, pinned by
-- `src/test/invitationMint.pglite.test.js`: `btrim(E'  x\t') = E'x\t'` and
-- `btrim(E'\nx ') = E'\nx'` are both true. (cairn:
-- postgres-btrim-trims-spaces-only.)
--
-- WHY THAT IS A DEFECT AND NOT A DETAIL. The ordinary way a code arrives is
-- copied out of a message — #172's Share sends "Your Taskr invitation code is
-- k7m3qp4rwn." — and a copied line very often carries the newline after it.
-- Under `0040` that paste hashes to a digest no invitation holds and is refused
-- with the one sentence all four unusable states share, so the person is told a
-- correct code cannot be used and nothing on either side says why. #173 AC 8
-- says a code with "surrounding whitespace ... is normalised and accepted", and
-- a trailing newline is the surrounding whitespace that fails today.
--
-- WHICH CHANNEL CAN DELIVER IT — a qualification measured while this was built.
-- A single-line `<input>` strips CR and LF from its value by the platform's own
-- sanitisation (jsdom and every browser alike), so from THIS app's own field
-- only a leading or trailing TAB can reach the server; the newline reproduction
-- is a raw RPC caller, a textarea, or another client. The client also
-- pre-normalises before its call. So the case this file fixes is real and the
-- app's field is not where it shows — which is a second reason the server, and
-- not the field, is the place to widen.
--
-- TWO ROUTES, AND THE OWNER CHOSE THE SERVER (2026-09-11, at a clickable
-- question at #173's pickup). The client could have stripped the wider set
-- before the call, with no migration; the server re-normalises whatever it is
-- handed, so that is safe — and it covers THIS client only. Widening here
-- covers every caller there will ever be, at the cost of one paste, and it
-- keeps the rule where `0040`'s header put it: "two normalisations in two
-- places is one drift away from a code that cannot be redeemed", so the
-- normalisation lives in the function and the client's twin is written to
-- match it. `normalizeInvitationCode` in `src/lib/invitations.js` widens to the
-- same four characters in the same change, and the mint-to-redeem cross-check
-- (`invitationMint.pglite.test.js`) asserts the pair agree on the inputs that
-- differ — a tab, a newline, a carriage return — rather than only on the ones
-- the two happened to agree on already.
--
-- THE SET IS EXACTLY FOUR CHARACTERS: space, tab, carriage return, newline.
-- Not `\s`, not Unicode whitespace, and the narrowness is deliberate: the code
-- is drawn from a 31-symbol ASCII alphabet, so the only whitespace that can
-- reach it is what a copy-paste or a keyboard adds around it, and every wider
-- set is a second thing the client would have to agree with for no input that
-- occurs. `regexp_replace` was the other spelling and was rejected for the same
-- reason `0040` chose `btrim`: a two-argument `btrim` is one lookup to read and
-- one expression to mirror.
--
-- EVERYTHING ELSE IS `0040`'S, UNCHANGED. The body below is `0040`'s function
-- with one expression widened. The refusals, their one-sentence rule (Decision 4
-- clause 4), the already-a-member check before anything is spent, the
-- primary-key lock and the re-read under it are all as `0040` wrote them and
-- for `0040`'s reasons — read that file's header; this one does not restate
-- it. `create or replace` on an existing function PRESERVES its ACL (`0028`'s
-- measured reading), and the revoke-then-grant is restated anyway so this file
-- carries the complete privilege statement on its own — `0034`'s idiom,
-- `from public, anon`, whose second word is load-bearing on this project.
--
-- WHAT EACH INSTRUMENT CAN SEE. `npm run check:live` sees NOTHING of this file:
-- it probes `redeem_invitation` by name and argument set (listed since #173),
-- and neither moves. `npm run probe:live-grants` sees nothing either: no grant
-- moves. The instrument is the read-only catalog query in
-- `docs/access-model.md`'s `0041` entry — `pg_get_functiondef` taken BEFORE
-- and AFTER the apply, asserting the widened `btrim` is present after and
-- absent before, with `prosecdef`, `proconfig`, `has_function_privilege` for
-- `authenticated` and `anon`, and `obj_description` read in the same select as
-- the control that the replace preserved everything it was not asked to change
-- (`0028`'s shape).
--
-- RE-RUNNABILITY. `create or replace`, and revokes and grants that are
-- idempotent by nature; applying it twice changes nothing, which
-- `invitationWhitespace.pglite.test.js` proves. The re-paste hazard runs the
-- OTHER way and is asserted in the same file: re-pasting `0040` alone on top of
-- this file succeeds silently and reverts the normalisation to spaces only —
-- `0028`'s hazard exactly. The repair is re-pasting this file, and
-- `docs/access-model.md`'s safe re-paste order now ends here.

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

  -- Normalised before hashing — #173 AC 8. The SECOND argument is this file's
  -- whole change: space, tab, carriage return and newline, in that order, as
  -- the four characters a paste or a keyboard can put around a code. `0040`
  -- wrote `btrim(code)`, whose set defaults to a single space, so a code copied
  -- with its line ending was refused as unusable. `normalizeInvitationCode` in
  -- `src/lib/invitations.js` strips exactly these four, and the cross-check
  -- test holds the two equal.
  digest := extensions.digest(
    lower(btrim(redeem_invitation.code, E' \t\r\n')),
    'sha256'
  );

  -- Identified by the digest, then locked by PRIMARY KEY below — `0040`'s
  -- reason, and cairn's a-lock-through-a-mutable-predicate-loses-its-row.
  select i.* into target
  from public.invitations i
  where i.token_hash = digest;

  -- One sentence for four states — Decision 4 clause 4, `0040` section 4.
  if not found
     or target.withdrawn_at is not null
     or target.redeemed_at is not null
     or target.expires_at <= now() then
    raise exception 'that invitation cannot be used';
  end if;

  -- Already inside, checked BEFORE anything is spent — #173 AC 2.
  if exists (
    select 1 from public.members m
    where m.household_id = target.household_id
      and m.claimed_by = caller
  ) then
    raise exception 'you are already in that household';
  end if;

  -- The lock, by primary key.
  select i.* into target
  from public.invitations i
  where i.id = target.id
  for update;

  -- Re-read under the lock — `0040` AC 6.
  if target.redeemed_at is not null or target.withdrawn_at is not null then
    raise exception 'that invitation cannot be used';
  end if;

  -- The member row, with the placeholder name the recipient replaces (#191).
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
  'member before spending anything. Story #171; the code is normalised with '
  'lower(btrim(code, E'' \t\r\n'')) since 0041 (story #173, AC 8), so a code '
  'pasted with its line ending is accepted.';

-- `from public, anon` — `0034`'s idiom, restated so this file carries the
-- complete privilege statement even though the replace preserves the ACL.
revoke all on function public.redeem_invitation(text) from public, anon;
grant execute on function public.redeem_invitation(text) to authenticated;
