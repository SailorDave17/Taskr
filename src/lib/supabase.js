import { createClient } from '@supabase/supabase-js'
import { assertPublishableKey } from './keyShape.js'

// The two values Vercel holds. They are `VITE_`-prefixed, so they are inlined
// into the client bundle at build time and are readable by anyone who views
// source. That is fine for the anon key and only because row-level security is
// on — the policies in supabase/migrations/ are what protect the data, never the
// key. The `service_role` key bypasses RLS entirely and must never appear here,
// in git, or in any `VITE_` variable.
const url = import.meta.env?.VITE_SUPABASE_URL
const anonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY

/**
 * Whether this build was given a backend. False in a local checkout with no
 * `.env.local`, which is a normal state and not an error until something
 * actually needs the database.
 */
export const hasSupabaseConfig = Boolean(url && anonKey)

let client = null

/**
 * The shared Supabase client.
 *
 * Throws rather than returning a half-configured client. A client built from
 * `undefined` fails later, at a call site, with a network error that reads like
 * the database being down — which sends you to check the wrong thing.
 */
export function getSupabase() {
  if (!hasSupabaseConfig) {
    throw new Error(
      'Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. ' +
        'Locally these go in .env.local (gitignored); in Vercel they are project ' +
        'environment variables. Note they are inlined at BUILD time, so a running ' +
        'dev server or an existing deployment will not pick up a new value.',
    )
  }
  // Belt to vite.config.js's braces. The build-time check is the one that stops
  // a secret key ever reaching a bundle; this one catches a dev server started
  // against a bad .env.local, where no build runs at all.
  assertPublishableKey(anonKey, 'the browser client')

  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  }
  return client
}
