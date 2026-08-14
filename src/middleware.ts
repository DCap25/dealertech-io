import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isPublicPath } from '@/lib/auth/routes'

/**
 * Session refresh and route protection.
 *
 * Two jobs. It refreshes the Supabase token on every request — Server
 * Components cannot write cookies, so without this the session would expire
 * mid-shift and an advisor would be signed out at the drive. And it turns away
 * anonymous visitors before a protected page renders.
 *
 * This is a gate, not the security boundary. Pages still resolve identity
 * server-side via `getCurrentUser()`; middleware can be bypassed by a
 * misconfigured matcher, so nothing here is the only thing standing between a
 * stranger and customer data.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  // Without Supabase configured there is no session to refresh. Let the request
  // through so a fresh clone can still reach the marketing site and the
  // sign-in page explains what is missing.
  if (!url || !key) return response

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(toSet) {
        for (const { name, value } of toSet) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  const { data } = await supabase.auth.getUser()

  const { pathname, search } = request.nextUrl
  if (!data.user && !isPublicPath(pathname)) {
    const login = request.nextUrl.clone()
    login.pathname = '/login'
    // Come back to where they were headed once they are signed in.
    login.search = `?next=${encodeURIComponent(pathname + search)}`
    return NextResponse.redirect(login)
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image optimisation. Listing
     * exclusions rather than inclusions keeps a newly added route protected by
     * default instead of only when someone remembers to add it here.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
