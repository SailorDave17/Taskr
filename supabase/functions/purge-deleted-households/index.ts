// #430 — the platform binding for purge-deleted-households, and nothing else.
// Every decision is in handler.ts, where npm test can reach it; this file only
// hands the edge runtime's fetch, environment and client factory to it.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { createHandler } from './handler.ts'

Deno.serve(
  createHandler({
    fetch: (input, init) => fetch(input, init as RequestInit),
    env: (name: string) => Deno.env.get(name),
    createClient: (url, key, options) => createClient(url, key, options as never) as never,
  }),
)
