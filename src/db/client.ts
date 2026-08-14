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

/**
 * Supabase's transaction pooler (Supavisor), which is what a serverless
 * deployment has to talk to.
 *
 * A direct connection holds a real Postgres backend for the life of the
 * socket. That is fine for one long-lived `next start` process and fatal for
 * functions, where every concurrent invocation is its own instance: the
 * project's connection limit is reached long before its request limit is, and
 * the symptom is intermittent "remaining connection slots are reserved"
 * errors rather than anything that looks like a capacity problem.
 */
function isTransactionPooler(url: string): boolean {
  return url.includes('pooler.supabase.com') || url.includes(':6543')
}

/** Netlify, Vercel, Lambda — anywhere the process does not outlive the request. */
function isServerless(): boolean {
  return Boolean(
    process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL,
  )
}

/**
 * Fail on a malformed URL before anything else touches it.
 *
 * Node's URL parser puts the string it could not parse into the error, and
 * postgres.js lets that propagate — so one mistyped connection string wrote a
 * live database password into a hosting provider's log, where it sits for as
 * long as logs are retained. That happened here with an unedited
 * `aws-0-<region>` placeholder from Supabase's Connect panel.
 *
 * This checks the shape first and throws a message that names the problem
 * without ever quoting the value.
 */
function assertUsableUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    const placeholder = /<[^>]+>/.test(url)
    throw new Error(
      placeholder
        ? 'DATABASE_URL still contains a <placeholder> from the connection-string template. ' +
          'Replace it with the real value — Supabase shows aws-0-<region>, which needs your ' +
          'project region substituted in.'
        : 'DATABASE_URL is not a valid URL. If the password contains @ : / ? # or [ ], each ' +
          'must be percent-encoded.',
    )
  }

  if (!parsed.hostname || parsed.hostname.includes('<')) {
    throw new Error('DATABASE_URL has no usable hostname — check for an unreplaced placeholder.')
  }
}

export function getDb(connectionString?: string) {
  const url = connectionString ?? process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.')
  }
  assertUsableUrl(url)

  if (!cached || connectionString) {
    const pooled = isTransactionPooler(url)

    if (isServerless() && !pooled && !connectionString) {
      // Loud, once, at startup — not an exception. A deploy that refuses to
      // serve is worse than one that serves and warns, and the failure this
      // predicts is intermittent enough to be hard to attribute later.
      console.warn(
        '[db] DATABASE_URL is a direct Postgres connection but this is a serverless runtime. ' +
          'Use the Supabase transaction pooler (port 6543) or expect connection-slot exhaustion.',
      )
    }

    const client = postgres(url, {
      /**
       * One connection per instance when pooling happens upstream. Anything
       * higher multiplies by the number of concurrent function instances,
       * which is exactly what the pooler exists to prevent.
       */
      max: pooled || isServerless() ? 1 : 5,
      /**
       * Transaction pooling hands a different backend to each statement, so a
       * prepared statement created on one is not there for the next. postgres.js
       * uses them by default; leaving that on produces "prepared statement
       * already exists" under load and nothing at all when idle.
       */
      prepare: pooled ? false : undefined,
      // Serverless invocations are short; do not let a socket outlive the
      // instance holding it.
      idle_timeout: isServerless() ? 20 : undefined,
      onnotice: () => {},
    })
    const db = drizzle(client, { schema })
    if (!connectionString) cached = db
    return db
  }
  return cached
}

export { schema }
export type Database = ReturnType<typeof getDb>
