// #430 — the Vercel function the daily cron calls, and the only Vercel function
// in this repo.
//
// It exists because a privacy purge must run even if nobody opens the app, and
// everything else here is client-triggered (docs/hosting-decision.md, amended
// for this on 2026-09-11). It does one thing: check that the caller is Vercel's
// cron, then ask the `purge-deleted-households` Edge Function to purge, passing
// the purge secret. It holds no Supabase key: the Edge Function does the work
// with the service key, which never leaves Supabase.
//
// It also keeps the free Supabase project warm, as a SIDE EFFECT: a free
// project pauses after a week with no activity, and this is activity every day.
// That is a workaround for the pause (docs/hosting-decision.md), not a design —
// retire or thin out this cron and the project can pause again.
//
// Environment (Vercel project, Production):
//   CRON_SECRET          set by the owner; Vercel sends it as `Authorization: Bearer`
//   PURGE_FUNCTION_URL   https://<project-ref>.supabase.co/functions/v1/purge-deleted-households
//   PURGE_SHARED_SECRET  the same value as the Edge Function's secret of that name
//
// Vercel never retries a failed cron and keeps Hobby logs for one hour, so a
// failure answers non-2xx to be visible for that hour, and the Edge Function
// records every run in `household_purge_runs` for longer than that.

/** Compare two strings in constant time. */
export function sameSecret(given, expected) {
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(expected)
  let difference = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return difference === 0
}

/** The handler as a function of its environment and fetch, so a test can drive it. */
export function createPurgeProxy({ env, fetch }) {
  return async function GET(request) {
    // Vercel's documented check, which refuses when the secret is UNSET as well
    // as when it is wrong: an absent secret is not a secret everybody knows.
    const cronSecret = env.CRON_SECRET
    const authorization = request.headers.get('authorization') ?? ''
    if (!cronSecret || !sameSecret(authorization, `Bearer ${cronSecret}`)) {
      return new Response('Unauthorized', { status: 401 })
    }

    const url = env.PURGE_FUNCTION_URL
    const purgeSecret = env.PURGE_SHARED_SECRET
    if (!url || !purgeSecret) return new Response('Not configured', { status: 500 })

    let response
    try {
      response = await fetch(url, { method: 'POST', headers: { 'x-purge-secret': purgeSecret } })
    } catch {
      return new Response('The purge function could not be reached', { status: 502 })
    }

    // The Edge Function's body is counts only, so passing it through names
    // nobody, and it makes the run readable for the hour the log is kept.
    const body = await response.text()
    return new Response(body, {
      status: response.ok ? 200 : 502,
      headers: { 'content-type': 'application/json' },
    })
  }
}

export const GET = createPurgeProxy({
  env: process.env,
  fetch: (input, init) => globalThis.fetch(input, init),
})
