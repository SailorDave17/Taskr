// The two Supabase clients a function builds per request — #562.
//
// Every function that holds `service_role` settles the caller's authority with
// a CALLER-SCOPED client first — the anon key plus the caller's own JWT, so row
// level security answers "who is this and what may they see" — and only then
// uses the service client for the writes no client is granted. The two
// factories below are that shape, written once. Constructing a client grants
// nothing; what matters is which one answers the authorization questions, and
// that ordering stays in each handler where it can be read beside its reasons.
//
// The SDK's `createClient` is INJECTED rather than imported: the handler suites
// run under node in `npm test` with a fake, and an `npm:` specifier here would
// not resolve there. Each function's `index.ts` passes the real one.

/** The injected constructor, typed as narrowly as each handler's own fake. */
export type ClientFactory<Client> = (url: string, key: string, options?: unknown) => Client

/**
 * A client that acts AS the caller: the anon key, with the caller's JWT on
 * every request, so row level security scopes every read to them.
 *
 * @param authorization the request's own `Authorization` header, passed
 *   through verbatim — never rebuilt from a token this code parsed.
 */
export function asCaller<Client>(
  createClient: ClientFactory<Client>,
  url: string,
  anonKey: string,
  authorization: string,
): Client {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * A client holding `service_role`: it bypasses row level security entirely.
 * Only for the writes the caller-scoped checks have already authorised.
 */
export function asService<Client>(
  createClient: ClientFactory<Client>,
  url: string,
  serviceKey: string,
): Client {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
