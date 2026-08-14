import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase client using the secret key.
 *
 * This bypasses row-level security and storage policies entirely, so it is
 * held to the same rule as the privileged database client: only ever from
 * trusted server code that has already established who the user is and what
 * store they belong to.
 *
 * It exists because object storage has no equivalent of "the signed-in user's
 * JWT already proves this". Uploading a customer's document requires write
 * access to a private bucket, and granting that to every authenticated session
 * through a storage policy would be a broader permission than the one thing we
 * actually need — which is for *our server*, having already checked the
 * advisor's session and their store, to put one file somewhere.
 */

let cached: SupabaseClient | null = null

export function getSupabaseAdminClient(): SupabaseClient {
  if (cached) return cached

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required for document storage.',
    )
  }

  cached = createClient(url, secret, {
    // No session to persist or refresh — this client is not a user.
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cached
}
