import 'server-only'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  hashInviteToken, inviteStatus, normaliseEmail, type InviteStatus,
} from './invite'

/**
 * Turning an invitation into an account.
 *
 * Kept out of the server action so the order of operations is readable in one
 * place, because getting it wrong leaves wreckage: an auth user with no
 * dealership can sign in and see a blank product, and a role row pointing at
 * an auth user that was never created is a login that fails forever.
 */

export interface LoadedInvite {
  id: string
  storeId: string
  storeName: string
  email: string
  role: string
  status: InviteStatus
}

/** Look up an invitation by the raw token from the URL. */
export async function loadInvite(token: string, now: Date): Promise<LoadedInvite | null> {
  if (!token) return null

  const db = getDb()
  const [row] = await db
    .select({
      id: schema.storeInvitations.id,
      storeId: schema.storeInvitations.storeId,
      storeName: schema.stores.name,
      email: schema.storeInvitations.email,
      role: schema.storeInvitations.role,
      expiresAt: schema.storeInvitations.expiresAt,
      acceptedAt: schema.storeInvitations.acceptedAt,
      revokedAt: schema.storeInvitations.revokedAt,
    })
    .from(schema.storeInvitations)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.storeInvitations.storeId))
    .where(eq(schema.storeInvitations.tokenHash, hashInviteToken(token)))
    .limit(1)

  if (!row) return null

  return {
    id: row.id,
    storeId: row.storeId,
    storeName: row.storeName,
    email: row.email,
    role: row.role,
    status: inviteStatus(row, now),
  }
}

export type AcceptResult =
  | { ok: true; email: string }
  | { ok: false; error: string }

/**
 * Create the account and grant the role.
 *
 * ---------------------------------------------------------------------------
 * ORDER, AND WHY
 * ---------------------------------------------------------------------------
 * The application `users` row has to carry the same id as the Supabase auth
 * user, so the auth user must exist first. Everything after that is our own
 * data, and if any of it fails the auth user is deleted again — better to send
 * someone back to the link than to leave them with credentials that sign in to
 * nothing.
 *
 * The invitation is marked accepted last. A crash before that point leaves a
 * link that still works, which is recoverable; marking it first would leave a
 * person with no account and no way back in.
 */
export async function acceptInvite(
  invite: LoadedInvite,
  fullName: string,
  password: string,
  now: Date,
): Promise<AcceptResult> {
  const admin = getSupabaseAdminClient()
  const email = normaliseEmail(invite.email)

  const created = await admin.auth.admin.createUser({
    email,
    password,
    // They arrived holding a link sent to this address, which is the same
    // proof a confirmation email would have given us.
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })

  if (created.error || !created.data.user) {
    const message = created.error?.message ?? ''
    // The one case worth naming: they already have an account and should sign
    // in rather than be told something vague went wrong.
    if (/already registered|already been registered|exists/i.test(message)) {
      return { ok: false, error: 'An account already exists for this address. Sign in instead.' }
    }
    return { ok: false, error: 'Could not create the account. Please try again.' }
  }

  const userId = created.data.user.id
  const db = getDb()

  try {
    await db.insert(schema.users).values({
      id: userId,
      email,
      fullName: fullName || email,
    })

    await db.insert(schema.userStoreRoles).values({
      userId,
      storeId: invite.storeId,
      role: invite.role as typeof schema.userStoreRoles.$inferInsert['role'],
      isActive: true,
    })

    await db.update(schema.storeInvitations)
      .set({ acceptedAt: now, acceptedByUserId: userId })
      .where(eq(schema.storeInvitations.id, invite.id))
  } catch {
    // Roll the auth user back so the link can be tried again cleanly.
    await admin.auth.admin.deleteUser(userId).catch(() => {})
    return { ok: false, error: 'Could not finish setting up the account. Please try the link again.' }
  }

  return { ok: true, email }
}
