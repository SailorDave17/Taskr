// Extract structured facts from one plain-language description — story #208.
// The platform binding, and nothing else.
//
// Every decision this endpoint makes lives in `handler.ts`, behind injected
// dependencies. This file exists to supply them from the edge runtime, and it
// is deliberately too small to hold a mistake: there is no branch here to get
// wrong, and `handler.test.js` covers everything there is by running the same
// `createHandler` in `npm test` with no network.
//
// The split is `calendar-connect`'s, for `calendar-connect`'s reason: there is
// no local provider, so a suite that needed one would leave every branch #208
// AC 5 is about — a provider error, a timeout, an answer that does not parse —
// covered by nothing CI runs.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { createHandler } from './handler.ts'

Deno.serve(
  createHandler({
    fetch: (input, init) => fetch(input, init as RequestInit),
    env: (name: string) => Deno.env.get(name),
    // Cast because `handler.ts` names only the handful of methods it calls: the
    // point of the injection is that a test can supply a fake, and a fake
    // satisfying the whole SDK interface is a fake nobody writes.
    createClient: (url, key, options) => createClient(url, key, options as never) as never,
  }),
)
