import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import {
  ACTIVE_STORE_COOKIE, resolveActiveStore,
  type StaffRole, type StoreMembership,
} from './active-store'

/**
 * Who is using the app right now.
 *
 * One function, resolved once per request, that everything else depends on.
 * Before this existed, "the advisor" was whichever row the database returned
 * first — which is how a scorecard ended up showing one advisor's numbers to
 * another.
 */

/*
  Re-exported so callers keep importing "the session" rather than having to
  know which half of it is pure.
*/
export {
  ACTIVE_STORE_COOKIE, resolveActiveStore,
  type StaffRole, type StoreMembership,
} from './active-store'

export interface CurrentUser {
  /** Matches `auth.users.id`, which is what every RLS policy resolves on. */
  id: string
  email: string
  name: string
  /** The active rooftop. Every tenant-scoped query keys off this. */
  storeId: string
  storeName: string
  role: StaffRole
  /** Roles that work the drive and own follow-ups. */
  isAdvisor: boolean
  /**
   * Every rooftop this person can work.
   *
   * Dealer groups move staff between stores, and a fixed-ops director often
   * covers several. Anything more than one turns on the store switcher.
   */
  memberships: StoreMembership[]
  /**
   * DealerTech staff, not dealership staff.
   *
   * Unlocks the operational console at /admin — tenants, leads, job health —
   * and grants no access whatsoever to any dealership's customers. That
   * separation is the whole design; see migration 0016.
   */
  isPlatformAdmin: boolean
}

/**
 * Cached for the lifetime of one request.
 *
 * A page renders many server components and most of them want the current
 * user; without this, a single Drive render would issue the same two queries
 * a dozen times.
 */
/**
 * Everything the request knows about who is calling.
 *
 * Permissive on purpose: `active` is null for DealerTech staff who hold no
 * dealership role, which is a legitimate and expected state. Workspace code
 * should use `getCurrentUser`, which requires a store; only the sign-in page
 * and the operational console reach for this.
 */
export interface Session {
  id: string
  email: string
  name: string
  /** The rooftop being worked, or null for platform staff with no store role. */
  active: StoreMembership | null
  memberships: StoreMembership[]
  isPlatformAdmin: boolean
}

export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await getSupabaseServerClient()

  // getUser() revalidates the token with Supabase. getSession() only decodes
  // the cookie, which a client could have tampered with.
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null

  const db = getDb()
  /*
    Every active membership, not the first one the database happened to return.

    Ordered by store name so the fallback is stable: without it, "their default
    rooftop" could change between requests, and a user would find themselves
    looking at a different dealership after a reload.
  */
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
    .where(and(
      eq(schema.users.id, data.user.id),
      eq(schema.userStoreRoles.isActive, true),
      eq(schema.stores.isActive, true),
    ))
    .orderBy(asc(schema.stores.name))

  const memberships: StoreMembership[] = rows.map((r) => ({
    storeId: r.storeId,
    storeName: r.storeName,
    role: r.role as StaffRole,
  }))

  /*
    The cookie chooses; the membership list authorises.

    Read as a hint and then checked against what this user actually holds, so a
    hand-edited cookie naming another dealership's id resolves to nothing and
    falls back to their own first rooftop.
  */
  const requested = (await cookies()).get(ACTIVE_STORE_COOKIE)?.value
  const active = resolveActiveStore(memberships, requested)

  const platform = await db
    .select({ id: schema.platformAdmins.id })
    .from(schema.platformAdmins)
    .where(and(
      eq(schema.platformAdmins.userId, data.user.id),
      isNull(schema.platformAdmins.revokedAt),
    ))
    .limit(1)

  const isPlatformAdmin = platform.length > 0

  /**
   * Authenticated, but neither dealership staff nor DealerTech staff.
   *
   * Treated as signed out rather than as an error: it is what an invited user
   * looks like before someone grants them a store role, and the sign-in page
   * explains that better than a crash does.
   */
  if (!active && !isPlatformAdmin) return null

  const [identity] = await db
    .select({ email: schema.users.email, fullName: schema.users.fullName })
    .from(schema.users)
    .where(eq(schema.users.id, data.user.id))
    .limit(1)

  return {
    id: data.user.id,
    email: identity?.email ?? data.user.email ?? '',
    name: identity?.fullName ?? identity?.email ?? data.user.email ?? '',
    active,
    memberships,
    isPlatformAdmin,
  }
})

/**
 * Who is signed in, with a dealership attached.
 *
 * The workspace runs on this. Returns null for DealerTech staff who hold no
 * store role — correct, because there is no drive to show them — which is why
 * sign-in sends them to the operational console instead of the workspace.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getSession()
  if (!session?.active) return null

  const { active } = session
  return {
    id: session.id,
    email: session.email,
    name: session.name,
    storeId: active.storeId,
    storeName: active.storeName,
    role: active.role,
    isAdvisor: active.role === 'ADVISOR' || active.role === 'SERVICE_MANAGER',
    memberships: session.memberships,
    isPlatformAdmin: session.isPlatformAdmin,
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

/**
 * DealerTech staff, or a 404.
 *
 * Not a redirect and not a 403. Somebody probing for an admin console should
 * not learn from the response that one exists — and a dealership user who
 * follows a stale link gets the same page as a typo, which is the truthful
 * answer for them anyway.
 */
export async function requirePlatformAdmin(): Promise<Session> {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!session.isPlatformAdmin) notFound()
  return session
}

/**
 * The rooftop being worked, in full.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * It replaces `getDefaultStore()`, which was `SELECT * FROM stores LIMIT 1` —
 * fine while exactly one dealership existed, and catastrophic the moment a
 * second one did: every page would have shown the new customer whichever store
 * the database returned first.
 *
 * Engines need more than an id. Labour rate prices every estimate, state drives
 * CARB terms and inspection rules, and the franchise brand decides which
 * schedule a menu is built from — so this returns the row, not just the id.
 *
 * Cached per request, like the user it depends on.
 */
export const getCurrentStore = cache(async () => {
  const user = await requireUser()
  const db = getDb()
  const [store] = await db
    .select()
    .from(schema.stores)
    .where(eq(schema.stores.id, user.storeId))
    .limit(1)
  return store
})
