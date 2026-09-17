/**
 * The website's way in — #343.
 *
 * `https://taskr.madcowhq.com/?start` opens the app on "start your household":
 * the create-your-account card first, with the sign-in form as the link
 * underneath. The ordinary root opens on sign-in (#154), because nearly
 * everyone opening this app already belongs to a household; this flag inverts
 * that weight for ONE arrival — the visitor who followed the website's link,
 * whose whole reason for being here is the once-only thing.
 *
 * A QUERY FLAG ON THE ROOT, NOT A PATH. `/start` is a 404 on the deployed site
 * (measured 2026-09-04 and again 2026-09-16): there is no router and no SPA
 * rewrite, and #175/#176 — the stories that would have added them — were
 * closed as not planned on 2026-09-09. So the root is the only URL that
 * reaches the app, and the query string is the only place on it a marker can
 * ride that nothing else already reads: the fragment is the implicit flow's
 * channel (`readSignInReturn`, `readAuthCallback`), and `?code=&state=` is the
 * calendar's (`readConsentReturn`).
 *
 * READ ONCE, THEN STRIPPED. The flag is read at boot and removed from the URL
 * with `history.replaceState` before anything else looks, so a reload does not
 * re-arm it, a sign-out later in the session lands on sign-in as it should
 * (#440 remounts the app, and the fresh boot reads a URL with no flag), and the
 * two query readers named above never see it. That is #304's lesson applied
 * in advance: a URL parameter that outlives the boot that read it gets
 * misread as somebody else's return.
 *
 * `start` is the only name, and this module is the only reader. Nothing else
 * in the app reads a `start` parameter, and a second reader would be a second
 * opinion about the same URL.
 */
export const START_FLAG = 'start'

/**
 * Is the flag on this query string? `?start`, `?start=` and `?start=anything`
 * all count — a website link is typed by a person, and the value carries no
 * information.
 */
export function readStartFlag(search) {
  return new URLSearchParams(String(search ?? '')).has(START_FLAG)
}

/**
 * The same query string with the flag taken out, keeping everything else in
 * its order — `''` when nothing remains, so the caller can append it to the
 * pathname either way. Anything else on the URL is somebody else's and is left
 * exactly as it arrived: the calendar's `?code=&state=` still has to be read
 * after this runs.
 */
export function withoutStartFlag(search) {
  const params = new URLSearchParams(String(search ?? ''))
  params.delete(START_FLAG)
  const rest = params.toString()
  return rest ? `?${rest}` : ''
}
