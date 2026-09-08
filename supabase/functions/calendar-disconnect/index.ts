// Forget a member's Google Calendar — story #99. The platform binding, and nothing else.
//
// Every decision this endpoint makes lives in `handler.ts`, behind injected
// dependencies. This file exists to supply them from the edge runtime, and it is
// deliberately too small to hold a mistake: there is no branch here to get
// wrong, and `handler.test.js` covers everything there is by running the same
// `createHandler` in `npm test` with no network.
//
// The split is not stylistic — `calendar-connect/index.ts` gives the argument,
// and it holds here for a second reason: AC 4's branch is the one where Google
// REFUSES the revocation and the rows go anyway, which nothing pointed at a real
// Google could produce on demand.

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
