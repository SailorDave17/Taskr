// Is this key safe to inline into a client bundle?
//
// Added after a measured incident, 2026-08-05: Vercel's VITE_SUPABASE_ANON_KEY
// was set to a `sb_secret_…` key. `VITE_` means inlined at build time, so it
// shipped into a world-readable preview bundle — and a secret key BYPASSES
// row-level security, which means the app would have worked perfectly while
// every policy in supabase/migrations/ was void. There was no symptom to
// notice, which is exactly why this is a build-time check and not a runbook
// line.
//
// The variable lives in a dashboard, outside this repository, so nothing in git
// could have caught it. This file is the closest thing available: the value has
// to pass through a build we control before it can reach anybody.
//
// Deliberately shape-based rather than a list of known-bad strings. A key we
// have never seen is the case that matters.
//
// EXTENDED for Google, 2026-08-24 (#95 AC 4), and extended rather than
// duplicated on #56 AC 5's rule: "the guard extended rather than a second
// mechanism added beside it". A second detector would be a second place to
// remember, and the one that gets forgotten is always the newer one. Google
// enters this repo with #95, which puts a client secret in an Edge Function's
// environment and a refresh token in `calendar_tokens` — and puts a Google
// CLIENT ID, which is public by design, into a `VITE_` variable one line away
// from where the secret would go. That adjacency is the whole hazard: the two
// values live on the same screen in the same Google console, they are pasted in
// the same sitting, and the wrong one produces a working build.

/** Decode base64 in either a browser or a Node build process. */
function decodeBase64(segment) {
  const normalised = segment.replace(/-/g, '+').replace(/_/g, '/')
  if (typeof atob === 'function') return atob(normalised)
  return Buffer.from(normalised, 'base64').toString('binary')
}

/**
 * The `role` claim of a legacy JWT-style Supabase key, or null if the key is
 * not a JWT or cannot be read. Legacy anon keys carry `"role":"anon"` and
 * legacy secret keys carry `"role":"service_role"`, and they are otherwise
 * indistinguishable by eye — both are a long `eyJ…` blob.
 */
export function jwtRole(key) {
  const parts = String(key ?? '').split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(decodeBase64(parts[1]))
    return typeof payload?.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

/**
 * WHICH kind of secret this value is, or null if it is safe to publish.
 *
 * Split out from `isSecretKey` when Google arrived, because the remedy is no
 * longer one sentence: a Supabase secret key is rotated in the Supabase
 * dashboard and a Google client secret in the Google Cloud console, and a
 * refusal that names the wrong console sends somebody to rotate nothing. The
 * boolean below is still the question almost every caller is asking.
 *
 * The Supabase half covers both key generations, because a project can be
 * issued either:
 *   - current: `sb_secret_…` (secret) vs `sb_publishable_…` (safe)
 *   - legacy:  a JWT whose role is `service_role` (secret) vs `anon` (safe)
 *
 * The Google half is prefix-based because Google's credentials are prefixed on
 * purpose, for exactly this — a scanner should be able to recognise one without
 * knowing whose it is:
 *   - `GOCSPX-…`  an OAuth client SECRET. Its sibling, the client ID, ends
 *                 `.apps.googleusercontent.com` and is public; that is the value
 *                 `VITE_GOOGLE_CLIENT_ID` is supposed to hold.
 *   - `1//…`      a refresh token. Long-lived, does not expire on its own, and
 *                 belongs to a PERSON rather than to this app — which makes it
 *                 the worst thing in the repo to publish. `0011` stores these in
 *                 `calendar_tokens`, which no client can read.
 *   - `ya29.…`    an access token. Short-lived, so a smaller leak than the other
 *                 two, and included because "smaller" is not "harmless" and the
 *                 prefix is unambiguous.
 */
export function secretKeyKind(key) {
  const value = String(key ?? '')
  if (!value) return null

  if (value.startsWith('sb_secret_')) return 'supabase-secret'
  if (jwtRole(value) === 'service_role') return 'supabase-secret'
  // A bare `service_role` anywhere in the value is not a shape we expect, and
  // there is no legitimate reason for it to appear in a browser-bound key.
  if (value.includes('service_role')) return 'supabase-secret'

  if (value.startsWith('GOCSPX-')) return 'google-client-secret'
  if (value.startsWith('1//')) return 'google-refresh-token'
  if (value.startsWith('ya29.')) return 'google-access-token'

  // #203 — the Anthropic API key arrives with the extraction adapter, and this
  // entry lands in the SAME story that first gives the key a reason to exist
  // (#56 AC 5 pulled forward: the guard should exist before the key does).
  // Prefix-based like the Google entries and for the same reason: Anthropic
  // keys are prefixed on purpose so a scanner can recognise one without
  // knowing whose it is. There is no publishable sibling — NO Anthropic
  // credential belongs in a client bundle, ever; the key lives with whatever
  // supplies the adapter's transport (the local runner's environment today,
  // the Edge Function's secrets at #209).
  if (value.startsWith('sk-ant-')) return 'anthropic-api-key'

  return null
}

/**
 * Would publishing this value hand a stranger something they should not have?
 *
 * Since #95 that is no longer only "bypass RLS" — a Google refresh token opens
 * a person's calendar and touches this database not at all.
 */
export function isSecretKey(key) {
  return secretKeyKind(key) !== null
}

/** The sentence that tells somebody where to go, per kind of secret. */
const REMEDY = Object.freeze({
  'supabase-secret':
    'Set VITE_SUPABASE_ANON_KEY to the PUBLISHABLE key (sb_publishable_… , or a legacy ' +
    'JWT whose role is "anon"). If a secret key has already been built, rotate it in ' +
    'Supabase → Project Settings → API Keys; redeploying alone does not invalidate it.',
  'google-client-secret':
    'That is a Google OAuth client SECRET (GOCSPX-…). The value a VITE_ variable may hold ' +
    'is the client ID, which ends .apps.googleusercontent.com. The secret belongs in the ' +
    'Edge Function environment as GOOGLE_CLIENT_SECRET and nowhere else. If it has already ' +
    'been built, rotate it in Google Cloud console → APIs & Services → Credentials.',
  'google-refresh-token':
    'That is a Google OAuth refresh token. It belongs to a PERSON, it does not expire on ' +
    'its own, and it never leaves calendar_tokens — no client is granted SELECT there. ' +
    'Revoke it at myaccount.google.com → Security → Third-party access.',
  'google-access-token':
    'That is a Google OAuth access token. Short-lived, but it must not be built into a ' +
    'bundle; the Edge Function obtains one per call and keeps it in memory.',
  'anthropic-api-key':
    'That is an Anthropic API key (sk-ant-…). It has no publishable sibling: no Anthropic ' +
    'credential belongs in a client bundle, under any variable name. It belongs in the ' +
    'environment of whatever supplies the extraction transport — ANTHROPIC_API_KEY for the ' +
    'local runner, an Edge Function secret at deploy. If it has already been built, rotate ' +
    'it at console.anthropic.com → API Keys.',
})

/**
 * Throw unless this value is safe to publish.
 *
 * `where` names the caller so the message says which build or which module
 * refused, rather than leaving someone to guess.
 */
export function assertPublishableKey(key, where = 'this build') {
  const kind = secretKeyKind(key)
  if (!kind) return

  throw new Error(
    `Refusing to continue: the value given to ${where} is a SECRET key.\n` +
      'VITE_ variables are inlined into the client bundle, so continuing would publish it ' +
      'to anyone who views source.\n' +
      `${REMEDY[kind]}\n` +
      'See docs/access-model.md.',
  )
}
