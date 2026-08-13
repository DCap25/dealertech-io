import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

/**
 * Server-side database client.
 *
 * This connects with credentials that BYPASS row-level security, so it must
 * only ever be used from trusted server code — migrations, seeds, sync jobs,
 * webhook handlers. Anything serving a user's session must go through the
 * Supabase client carrying that user's JWT, so RLS applies.
 */

let cached: ReturnType<typeof drizzle<typeof schema>> | undefined

export function getDb(connectionString?: string) {
  const url = connectionString ?? process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.')
  }
  if (!cached || connectionString) {
    const client = postgres(url, { max: 5, onnotice: () => {} })
    const db = drizzle(client, { schema })
    if (!connectionString) cached = db
    return db
  }
  return cached
}

export { schema }
export type Database = ReturnType<typeof getDb>
