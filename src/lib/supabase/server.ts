import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Supabase client bound to the request's cookies.
 *
 * Server-side only. The session lives in httpOnly cookies rather than
 * localStorage, so a token is never readable from client JavaScript — the
 * relevant standard here is the FTC Safeguards Rule, which treats a
 * dealership's customer data as financial-institution data.
 */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(toSet) {
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Server Components cannot set cookies. The middleware refreshes
            // the session on every request, so a read-only render here is
            // expected rather than an error worth surfacing.
          }
        },
      },
    },
  )
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill in your Supabase keys.`,
    )
  }
  return value
}
