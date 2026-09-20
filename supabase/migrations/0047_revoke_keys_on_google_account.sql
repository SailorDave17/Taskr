-- A Google grant is kept while another connection uses the same GOOGLE
-- ACCOUNT, not only the same Taskr sign-in — story #474.
--
-- `household_tokens_to_revoke` (0042) and `member_tokens_to_revoke` (0043)
-- left a token out of the revoke when the same Taskr sign-in
-- (`members.claimed_by`) held a token in another household. Their stated
-- reason was about the Google account — "one Google account holds one grant
-- with Taskr's OAuth client" — and Google's own documentation says the same,
-- more strongly: "Revocation removes all OAuth 2.0 scopes previously granted
-- to a project, invalidating any issued access or refresh tokens for all
-- clients registered under that project"
-- (developers.google.com/identity/protocols/oauth2/javascript-implicit-flow,
-- read 2026-09-17). So a grant belongs to a Google account, and revoking ANY
-- refresh token for it kills every other refresh token that account holds for
-- Taskr. Two Taskr sign-ins that consented the same Google account were
-- treated as unrelated, and one leaving took the other's calendar with it.
-- The criterion's alternative ending, "grants are per refresh token, close
-- this moot", is false by that sentence.
--
-- ===========================================================================
-- What changes
-- ===========================================================================
--
-- 1. `calendar_tokens.google_sub` — the Google account the token belongs to,
--    as Google's stable subject id (`sub`). `calendar-connect` reads it off
--    the `id_token` Google returns now that the consent asks for `openid`
--    (src/lib/calendar.js). The address is not stored: `sub` is the key
--    Google says never changes or gets reused, and the address is neither.
--    Nullable, because every row written before this file has none and
--    Taskr cannot find it out without spending the credential.
--
-- 2. Both revoke functions offer a token only when BOTH hold:
--
--    a. its account is KNOWN. A token with no `google_sub` is never offered
--       (owner decision at #474's pickup, 2026-09-17): it might be the same
--       account as a connection somewhere else, and #430's rule is that a
--       purge or a leave never breaks another household's calendar. The row
--       still goes with the cascade; the grant stays listed in that person's
--       Google account until they reconnect or remove it there.
--
--    b. no OTHER connection holds a token for the same account — compared by
--       `google_sub`, or, where the other row's account is unknown, by the
--       Taskr sign-in, which was the old rule and is still the best evidence
--       that row has. "Other" is another MEMBER ROW for a leave (so two
--       members of one household sharing an account are covered too) and
--       another HOUSEHOLD for a purge (the whole household is going, so its
--       own rows use nothing afterwards).
--
--    The residual, stated rather than hidden: a legacy row (account unknown)
--    held by a DIFFERENT Taskr sign-in that consented the same Google account
--    is invisible to both clauses. It closes as those rows reconnect. On
--    2026-09-17 the live project held one connection, in the owner's own
--    household.
--
-- `calendar-disconnect` calls `member_tokens_to_revoke` too since this story;
-- until now it revoked unconditionally, so disconnecting in one household
-- revoked the grant a second household used even for the SAME sign-in.
--
-- ===========================================================================
-- Instruments
-- ===========================================================================
--
-- `check:live` is blind to all of it: the column is on a table no client
-- names, and the two functions keep their names and argument sets (`0028`'s
-- reason). The read-only catalog query in docs/access-model.md's #474 section
-- reads the column and both bodies on each side of the apply. No grant
-- changes: 0011 grants `calendar_tokens` to service_role at TABLE level, so
-- the new column is covered by the grant that already exists.
--
-- ===========================================================================
-- Re-runnability
-- ===========================================================================
--
-- `add column if not exists`, `create or replace`, and revokes and grants,
-- which are idempotent. RE-PASTING `0042` OR `0043` ON TOP OF THIS FILE
-- RESTORES THE SIGN-IN-KEYED BODY of the function that file declares — the
-- `0031`-on-`0039` hazard, again. Re-paste this file after either.

alter table public.calendar_tokens add column if not exists google_sub text;

comment on column public.calendar_tokens.google_sub is
  'The Google account this token belongs to (the id_token''s sub). Null for a '
  'token stored before story #474, and such a token is never revoked by a '
  'leave or a purge.';

create or replace function public.household_tokens_to_revoke(household_id uuid)
returns table (refresh_token text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.refresh_token
  from public.calendar_tokens t
  join public.members m on m.id = t.member_id
  where t.household_id = household_tokens_to_revoke.household_id
    and t.google_sub is not null
    and not exists (
      select 1
      from public.calendar_tokens other
      join public.members om on om.id = other.member_id
      where other.household_id <> t.household_id
        and (
          other.google_sub = t.google_sub
          or (
            other.google_sub is null
            and m.claimed_by is not null
            and om.claimed_by = m.claimed_by
          )
        )
    );
$$;

comment on function public.household_tokens_to_revoke(uuid) is
  'service_role only: the refresh tokens the purge revokes at Google for one '
  'household — only tokens whose Google account is known, and none whose '
  'account another household still uses. Stories #430, #474.';

create or replace function public.member_tokens_to_revoke(member_id uuid)
returns table (refresh_token text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.refresh_token
  from public.calendar_tokens t
  join public.members m on m.id = t.member_id
  where t.member_id = member_tokens_to_revoke.member_id
    and t.google_sub is not null
    and not exists (
      select 1
      from public.calendar_tokens other
      join public.members om on om.id = other.member_id
      where other.member_id <> t.member_id
        and (
          other.google_sub = t.google_sub
          or (
            other.google_sub is null
            and m.claimed_by is not null
            and om.claimed_by = m.claimed_by
          )
        )
    );
$$;

comment on function public.member_tokens_to_revoke(uuid) is
  'service_role only: the refresh tokens a leave or a disconnect revokes at '
  'Google for one member — only a token whose Google account is known, and '
  'not one whose account another connection still uses. Stories #431, #474.';

revoke all on function public.household_tokens_to_revoke(uuid) from public, anon, authenticated;
revoke all on function public.member_tokens_to_revoke(uuid) from public, anon, authenticated;
grant execute on function public.household_tokens_to_revoke(uuid) to service_role;
grant execute on function public.member_tokens_to_revoke(uuid) to service_role;
