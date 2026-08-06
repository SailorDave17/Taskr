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
 * Would publishing this key hand a stranger the ability to bypass RLS?
 *
 * Covers both key generations, because a project can be issued either:
 *   - current: `sb_secret_…` (secret) vs `sb_publishable_…` (safe)
 *   - legacy:  a JWT whose role is `service_role` (secret) vs `anon` (safe)
 */
export function isSecretKey(key) {
  const value = String(key ?? '')
  if (!value) return false
  if (value.startsWith('sb_secret_')) return true
  if (jwtRole(value) === 'service_role') return true
  // A bare `service_role` anywhere in the value is not a shape we expect, and
  // there is no legitimate reason for it to appear in a browser-bound key.
  return value.includes('service_role')
}

/**
 * Throw unless this key is safe to publish.
 *
 * `where` names the caller so the message says which build or which module
 * refused, rather than leaving someone to guess.
 */
export function assertPublishableKey(key, where = 'this build') {
  if (!isSecretKey(key)) return

  throw new Error(
    `Refusing to continue: the Supabase key given to ${where} is a SECRET key.\n` +
      'It bypasses row-level security entirely, and VITE_ variables are inlined into the ' +
      'client bundle, so continuing would publish it to anyone who views source.\n' +
      'Set VITE_SUPABASE_ANON_KEY to the PUBLISHABLE key (sb_publishable_… , or a legacy ' +
      'JWT whose role is "anon"). If a secret key has already been built, rotate it in ' +
      'Supabase → Project Settings → API Keys; redeploying alone does not invalidate it.\n' +
      'See docs/access-model.md.',
  )
}
