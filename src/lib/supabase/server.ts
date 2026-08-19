import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Supabase client bound to the request's cookies.
 *
 * ---------------------------------------------------------------------------
 * THE SESSION COOKIE IS httpOnly, AND THAT IS A DECISION
 * ---------------------------------------------------------------------------
 * @supabase/ssr ships `httpOnly: false` in its DEFAULT_COOKIE_OPTIONS, because
 * the library also serves `createBrowserClient`, which has to read the token
 * out of `document.cookie` to work at all. This app has no browser client —
 * every Supabase call happens on the server, sign-in is a server action, and
 * nothing in the browser bundle ever looks at the auth cookie. So the default
 * bought nothing and cost the one mitigation that matters: with httpOnly off,
 * a single successful XSS anywhere on the origin reads the access and refresh
 * tokens straight out of the cookie jar and walks off with the session.
 *
 * `cookieOptions` is shallow-merged over DEFAULT_COOKIE_OPTIONS by the library
 * (`{ ...DEFAULT_COOKIE_OPTIONS, ...options.cookieOptions }`), so naming a key
 * here overrides only that key and `path: '/'` and the 400-day `maxAge` come
 * through untouched. `sameSite: 'lax'` is restated rather than inherited so
 * that it is visible beside the other two — it must stay `lax` rather than
 * `strict`, or the redirect back from Supabase's auth callback arrives without
 * the cookie it just set.
 *
 * `secure` is not in the library's defaults at all. It is set in production
 * only, deliberately: the drive is tested from tablets over the LAN at
 * `http://<laptop-ip>:3000`, and an unconditional `Secure` flag would make
 * sign-in silently impossible there while working perfectly on the developer's
 * own machine.
 *
 * ---------------------------------------------------------------------------
 * WHAT BREAKS IF SOMEONE ADDS A BROWSER CLIENT LATER
 * ---------------------------------------------------------------------------
 * `createBrowserClient` will appear to work and then behave like a user who is
 * permanently signed out: it cannot see an httpOnly cookie, so it finds no
 * session, and every query it makes runs as the anonymous role. The failure
 * looks like an RLS problem, not a cookie problem, which is why it is written
 * down here. Anyone reaching for a browser client should first ask whether the
 * work belongs in a server component or a server action — the answer has been
 * yes every time so far. If it genuinely is not, the fix is not to flip this
 * boolean back: it is to keep the session httpOnly and hand the browser only
 * the data it needs. Turning httpOnly off again re-exposes every session on
 * every page to any script that gets injected, and also makes the public
 * security page wrong.
 *
 * The public security page is the other half of this. Its "Sessions" entry
 * once claimed httpOnly and was corrected to drop the claim when this file
 * turned out not to set it; the claim is now true again, and the page is free
 * to say so. What it must never do is drift the other way — if this option is
 * ever removed, that page has to be read on the same day.
 */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    {
      cookieOptions: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      },
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
