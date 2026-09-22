// The first four questions every browser-invoked function here asks — #562.
//
// Is this a preflight, is it a POST, does it carry a Bearer token, and is the
// body a JSON object. Eight functions asked them in eight copies, and the
// copies had already diverged on the fourth: the null-body guard reached five
// of the seven handlers that read a body. One copy means the next guard added
// here reaches every function at once, and `gate.test.js` refuses a handler
// that grows its own `refuse` or `CORS` back.
//
// Every sentence and status below is the one the handlers already answered
// with, so the client's error handling reads the same refusals it always has.

import { CORS, refuse } from './http.ts'

/**
 * Answer a preflight, refuse anything that is not a POST.
 *
 * @returns the response to send, or `null` to carry on. Split out because
 *   `purge-deleted-households` asks only this: its caller is a cron holding a
 *   shared secret, not a person holding a session.
 */
export function acceptPost(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return refuse('Use POST.', 405)
  return null
}

export type CallerRequest<Body> =
  | { ok: true; authorization: string; body: Body }
  | { ok: false; response: Response }

/**
 * The preamble of a POST made by a signed-in person: method, Bearer, body.
 *
 * The Bearer check is only that the header is SHAPED like one. Whose token it
 * is gets settled afterwards by the caller-scoped client (`clients.ts`), which
 * is the only thing allowed to answer an authorization question.
 *
 * @param readBody false for a function whose request carries nothing
 *   (`delete-account`: the person is the JWT, and there is nothing else to
 *   name). Its `body` is then an empty object, never read.
 */
export async function callerRequest<Body extends object = Record<string, unknown>>(
  req: Request,
  { readBody = true }: { readBody?: boolean } = {},
): Promise<CallerRequest<Body>> {
  const early = acceptPost(req)
  if (early) return { ok: false, response: early }

  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) {
    return { ok: false, response: refuse('Sign in first.', 401) }
  }

  if (!readBody) return { ok: true, authorization, body: {} as Body }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return { ok: false, response: refuse('Send a JSON body.', 400) }
  }
  // `req.json()` resolves for the JSON literal `null` as happily as for an
  // object, and `null.householdId` is a TypeError the try above does not
  // cover — escaping as a bare 500 with no CORS headers, which a browser
  // reports as the network being down. Unreachable from this app's client
  // (supabase-js drops a null body before sending) and guarded anyway, because
  // a refusal that names its reason is the whole contract of this block
  // (review-fanout, 2026-09-04, second pass). Until #562 `calendar-connect` and
  // `provision-member` did not have it.
  if (!body || typeof body !== 'object') {
    return { ok: false, response: refuse('Send a JSON body.', 400) }
  }
  return { ok: true, authorization, body: body as Body }
}
