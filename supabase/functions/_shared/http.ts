// What every Edge Function here says over HTTP — #562.
//
// WHY ONE COPY
//
// Until #562 each of the nine functions carried its own CORS literal, its own
// `json` and its own `refuse`, and the four sentences above each copy said the
// list was "restated rather than imported". The copies were byte-identical and
// stayed that way only because nobody had yet needed to change one. The
// preamble beside this file is the proof of what happens next: the null-body
// guard added after the 2026-09-04 review reached five of the seven handlers
// that read a body, and the two it missed answered a `null` body with a bare
// 500 carrying no CORS headers.
//
// WHAT "RESTATED RATHER THAN IMPORTED" WAS ACTUALLY ABOUT, AND STILL IS
//
// The argument was never against sharing between functions. It was against
// importing the list from the SDK (`@supabase/supabase-js/cors`): that is a
// value resolved at deploy time from a package version, and a deploy-path
// constant that must not change silently should not be. That still holds, which
// is why the list below is a literal and not an import. A relative `_shared/`
// file is not resolved from anywhere at deploy time — the CLI's `--use-api`
// walker uploads it from the tree with each function that imports it, exactly as
// it has uploaded `calendar-disconnect/handler.ts` with `leave-household` since
// #431 — and `check:deployed` walks the same imports, so a commit here reads as
// every importing function going stale until it is redeployed.
//
// NO `npm:` SPECIFIER IN THIS DIRECTORY. The handler suites run these files
// under node in `npm test`, where `npm:` does not resolve; the platform binding
// that needs one is each function's `index.ts`, and it stays there.

/**
 * Every header supabase-js puts on a `functions.invoke` call.
 *
 * #112 is why the list is this long: a browser preflight asks about ALL of the
 * headers at once, and an allow-list missing even one fails the whole request
 * before it is sent. The client then reports `FunctionsFetchError`, whose
 * message is "Failed to send a request to the Edge Function": it names no
 * header, mentions no preflight, and reads exactly like a dropped connection.
 *
 * `authorization` and `content-type` are the two you would think of. The other
 * two are sent whether or not you ask for them, which is why the short list
 * looked complete: the client's fetch wrapper sets `apikey` on every request,
 * and `X-Client-Info` is a default header on every Supabase client.
 * `x-retry-count` is postgrest-js's, and is listed so this stays a SUPERSET of
 * the SDK's canonical set rather than the subset somebody happened to notice.
 *
 * `src/test/edge-function-cors.test.js` asserts this list still covers the
 * SDK's published set, so an SDK release that adds a header fails the gate here
 * rather than on a phone — and asserts every function imports it from here.
 *
 * `purge-deleted-households` is invoked by no browser, and carries these anyway:
 * a function that one day is called from one should not fail its preflight.
 */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-retry-count',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** A JSON answer, with the CORS headers on it — a browser hides any response without them. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })
}

/**
 * A refusal says what is wrong without saying whether anybody else exists.
 *
 * The caller-scoped read in each handler already decided what this caller may
 * know, and echoing more back would turn an endpoint into a way to probe other
 * households for valid ids. So a refusal carries the sentence the handler chose
 * and nothing else — `extra` exists for `calendar-events`' `needsScope` flag,
 * which is about the CALLER's own connection and names nobody.
 */
export function refuse(message: string, status: number, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status)
}
