import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { getSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Who is using the app right now.
 *
 * One function, resolved once per request, that everything else depends on.
 * Before this existed, "the advisor" was whichever row the database returned
 * first — which is how a scorecard ended up showing one advisor's numbers to
 * another.
 */

export type StaffRole = 'ADVISOR' | 'BDC' | 'SERVICE_MANAGER' | 'TECHNICIAN' | 'ADMIN'

export interface CurrentUser {
  /** Matches `auth.users.id`, which is what every RLS policy resolves on. */
  id: string
  email: string
  name: string
  storeId: string
  storeName: string
  role: StaffRole
  /** Roles that work the drive and own follow-ups. */
  isAdvisor: boolean
}

/**
 * Cached for the lifetime of one request.
 *
 * A page renders many server components and most of them want the current
 * user; without this, a single Drive render would issue the same two queries
 * a dozen times.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await getSupabaseServerClient()

  // getUser() revalidates the token with Supabase. getSession() only decodes
  // the cookie, which a client could have tampered with.
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null

  const db = getDb()
  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      fullName: schema.users.fullName,
      storeId: schema.userStoreRoles.storeId,
      storeName: schema.stores.name,
      role: schema.userStoreRoles.role,
    })
    .from(schema.users)
    .innerJoin(schema.userStoreRoles, eq(schema.userStoreRoles.userId, schema.users.id))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.userStoreRoles.storeId))
    .where(and(eq(schema.users.id, data.user.id), eq(schema.userStoreRoles.isActive, true)))
    .limit(1)

  const row = rows[0]

  /**
   * Authenticated but not staff anywhere.
   *
   * Treated as signed out rather than as an error: it is what an invited user
   * looks like before someone grants them a store role, and the sign-in page
   * explains that better than a crash does.
   */
  if (!row) return null

  const role = row.role as StaffRole
  return {
    id: row.id,
    email: row.email,
    name: row.fullName ?? row.email,
    storeId: row.storeId,
    storeName: row.storeName,
    role,
    isAdvisor: role === 'ADVISOR' || role === 'SERVICE_MANAGER',
  }
})

/**
 * The current user, or a redirect to sign-in.
 *
 * Pages call this instead of hand-rolling a null check, so a forgotten guard
 * cannot silently render a surface to an anonymous visitor.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return user
}
