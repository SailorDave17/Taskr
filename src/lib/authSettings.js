import { authSettingsRequest } from './supabase.js'

// #339 — whether the project's Google provider is switched on, read before the
// sign-in screen offers Continue with Google.
//
// WHY THE CONTROL CANNOT FIND OUT FOR ITSELF. `signInWithOAuth` does not ask
// Supabase anything: auth-js 2.112.1 builds the authorize URL locally and calls
// `window.location.assign(url)` (`GoTrueClient.js:2136`). With the provider off,
// `/auth/v1/authorize` answers **HTTP 400, `application/json`**,
// `{"code":400,"error_code":"validation_failed","msg":"Unsupported provider:
// provider is not enabled"}` — no redirect, so nothing ever comes back to
// `readSignInReturn` and the person is left on a page of raw JSON (measured
// 2026-09-04). The error branch in `signInWithGoogle` fires only when auth-js
// cannot BUILD the URL, which it does not fail to do. So the only place the
// answer can be had in time is `GET /auth/v1/settings`, which is public and
// reports `external.google`.
//
// THREE ANSWERS, NOT TWO. `true` and `false` are the project's; `null` means
// the read did not produce one — offline, a non-2xx, a body without the field,
// no backend. The screen treats `null` exactly like `true`: refusing to offer
// sign-in over a network blip is the worse error of the two (AC 1).
//
// ONE READ PER PAGE. The first call starts it and every later call gets the
// same promise, including a failed one — a sign-out remounts the app (#440),
// and it must not re-ask. The switch is flipped in a dashboard, rarely; a page
// that was open across the flip is fixed by a reload.

let pending = null

/**
 * `true` when the provider is on, `false` when it is off, `null` when unknown.
 * Never rejects.
 *
 * @param {{ fetchImpl?: typeof fetch, request?: () => ({ url: string, headers: object } | null) }} [options]
 * @returns {Promise<boolean | null>}
 */
export function readGoogleSignIn({
  fetchImpl = (...args) => globalThis.fetch(...args),
  request = authSettingsRequest,
} = {}) {
  if (!pending) pending = probe(fetchImpl, request)
  return pending
}

async function probe(fetchImpl, request) {
  try {
    const target = request()
    if (!target) return null
    const response = await fetchImpl(target.url, { headers: target.headers })
    if (!response?.ok) return null
    const settings = await response.json()
    const google = settings?.external?.google
    return typeof google === 'boolean' ? google : null
  } catch {
    return null
  }
}

/** Test seam: forget the cached read so the next call asks again. */
export function forgetGoogleSignIn() {
  pending = null
}
