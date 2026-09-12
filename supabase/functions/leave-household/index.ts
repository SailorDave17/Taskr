// Leave a household — #431. The platform binding, and nothing else.
//
// Every decision lives in `handler.ts`, behind three injected dependencies, so
// `handler.test.js` runs the same `createHandler` in `npm test` with no network
// and no Supabase — the shape `calendar-disconnect` and `provision-member` set.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { createHandler } from './handler.ts'

Deno.serve(
  createHandler({
    fetch: (input, init) => fetch(input, init as RequestInit),
    env: (name: string) => Deno.env.get(name),
    // Cast because `handler.ts` names only the handful of methods it calls.
    createClient: (url, key, options) => createClient(url, key, options as never) as never,
  }),
)
