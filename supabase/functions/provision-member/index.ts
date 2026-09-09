// Provision, invite, reset and revoke a member's credential — #62, #87, #247
// and #341. The platform binding, and nothing else.
//
// Every decision this endpoint makes lives in `handler.ts`, behind two injected
// dependencies. This file exists to supply them from the edge runtime, and it is
// deliberately too small to hold a mistake: there is no branch here to get
// wrong, and `handler.test.js` covers everything there is by running the same
// `createHandler` in `npm test` with no network and no Docker.
//
// The split arrived with #341 and `calendar-connect/index.ts` set its shape. The
// argument is the same one, about a different service: this function was
// exercised against a LOCAL Supabase stack, which CI does not run, and #341
// AC 4's branch — the mailer REFUSES the send — is one no local stack will
// produce on demand. A branch that decides whether an organizer is told "the
// sign-in was not created" cannot be covered by a suite that never runs.
//
// `src/test/provisioning.functions.test.js` still drives real HTTP against that
// local stack and is still the only thing that proves the authorization shape
// against a real Postgres with real row-level security. The two are not
// alternatives: one asks whether the rules hold, the other asks what happens
// when GoTrue says no.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { createHandler } from './handler.ts'

Deno.serve(
  createHandler({
    env: (name: string) => Deno.env.get(name),
    // Cast because `handler.ts` names only the handful of methods it calls: the
    // point of the injection is that a test can supply a fake, and a fake
    // satisfying the whole SDK interface is a fake nobody writes.
    createClient: (url, key, options) => createClient(url, key, options as never) as never,
  }),
)
