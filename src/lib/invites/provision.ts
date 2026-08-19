import 'server-only'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { normaliseEmail } from './invite'

/**
 * Standing up a new dealership.
 *
 * Used by self-serve signup and by sales-led provisioning, because they are the
 * same act with a different person doing it: an organisation, one rooftop, and
 * one administrator who can then invite everybody else.
 */

export interface NewTenant {
  dealershipName: string
  franchiseMake: string | null
  state: string | null
  laborRate: number
  adminName: string
  adminEmail: string
}

export type ProvisionResult =
  | { ok: true; storeId: string; userId: string; email: string }
  | { ok: false; error: string }

/**
 * A URL-safe slug that will not collide.
 *
 * Suffixed rather than checked-and-retried: two dealerships genuinely called
 * "Hill Country BMW" is a normal thing in a franchise network, and a loop that
 * probes for the next free name is a race waiting to happen.
 */
export function slugify(name: string, suffix: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${base || 'dealership'}-${suffix}`
}

/** The dealership itself, with nobody in it yet. */
export interface NewStore {
  dealershipName: string
  franchiseMake: string | null
  state: string | null
  laborRate: number
}

/**
 * Stand up an organisation and its first rooftop.
 *
 * Split out from `provisionTenant` because the two ways a dealership arrives
 * differ only in who the first account belongs to. Self-serve creates the
 * administrator immediately from a password they just chose; sales-led creates
 * nobody and sends an invitation instead, because the person who signs the
 * contract is rarely the person sitting at the keyboard when it is set up.
 *
 * `suffix` disambiguates the slug. Two dealerships genuinely called "Hill
 * Country BMW" is normal in a franchise network, and a check-then-insert loop
 * for the next free name is a race waiting to happen.
 */
/*
  Why there is no `checkAccess('ADD_STORE')` anywhere.

  `GuardedAction` names ADD_STORE, and access.ts explains what it is for: a
  group that is not paying for the rooftops it has should not quietly add more.
  There is simply no dealership-facing way to add one today, so the guard would
  have nothing to sit in front of. Both callers of this function are outside a
  tenant's reach — /signup stands up an organisation that has no lifecycle
  status to be judged against yet, and /admin provisioning runs behind
  `requirePlatformAdmin()` — and the billing side, `setRooftopQuantity`, is
  platform-admin-only as well.

  A guard added here would therefore refuse nobody and quietly imply a flow
  that does not exist. The day a manager can add a rooftop from their own side
  of the product, `checkAccess('ADD_STORE')` goes at the top of that action, in
  the shape src/app/team/actions.ts already uses.
*/
export async function createStore(
  input: NewStore,
  suffix: string,
): Promise<{ organizationId: string; storeId: string }> {
  const db = getDb()

  const [org] = await db.insert(schema.organizations).values({
    name: input.dealershipName,
    slug: slugify(input.dealershipName, suffix),
  }).returning({ id: schema.organizations.id })
  if (!org) throw new Error('organization insert returned nothing')

  const [store] = await db.insert(schema.stores).values({
    organizationId: org.id,
    name: input.dealershipName,
    slug: slugify(input.dealershipName, suffix),
    franchiseMake: input.franchiseMake,
    state: input.state,
    laborRate: input.laborRate.toFixed(2),
  }).returning({ id: schema.stores.id })
  if (!store) throw new Error('store insert returned nothing')

  return { organizationId: org.id, storeId: store.id }
}

/**
 * Create the org, the rooftop and the first administrator.
 *
 * The auth user comes first because the application `users` row has to carry
 * its id. If anything after that fails the auth user is removed again — an
 * account that signs in to no dealership is worse than no account, because the
 * person cannot tell what went wrong or try again.
 */
export async function provisionTenant(
  input: NewTenant,
  password: string,
): Promise<ProvisionResult> {
  const email = normaliseEmail(input.adminEmail)
  const admin = getSupabaseAdminClient()

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: input.adminName },
  })

  if (created.error || !created.data.user) {
    const message = created.error?.message ?? ''
    if (/already registered|already been registered|exists/i.test(message)) {
      return { ok: false, error: 'An account already exists for this address. Sign in instead.' }
    }
    return { ok: false, error: 'Could not create the account. Please try again.' }
  }

  const userId = created.data.user.id
  const db = getDb()
  const suffix = userId.slice(0, 8)

  try {
    const store = await createStore(input, suffix).then((r) => ({ id: r.storeId }))

    await db.insert(schema.users).values({
      id: userId, email, fullName: input.adminName || email,
    })

    /*
      The first person is an ADMIN, not a manager.

      Somebody has to be able to invite the rest of the department, and on a
      brand-new tenant there is nobody else to do it. Every later account comes
      through an invitation with an explicitly chosen role.
    */
    await db.insert(schema.userStoreRoles).values({
      userId, storeId: store.id, role: 'ADMIN', isActive: true,
    })

    return { ok: true, storeId: store.id, userId, email }
  } catch {
    await admin.auth.admin.deleteUser(userId).catch(() => {})
    // Best effort: the org may or may not exist depending on where it failed.
    await db.delete(schema.users).where(eq(schema.users.id, userId)).catch(() => {})
    return { ok: false, error: 'Could not finish creating the dealership. Please try again.' }
  }
}
