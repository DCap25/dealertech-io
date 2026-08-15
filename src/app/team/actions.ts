'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { requireUser } from '@/lib/auth/session'
import {
  createInviteToken, inviteExpiryFrom, isInvitableRole, normaliseEmail,
} from '@/lib/invites/invite'

export interface InviteState {
  error?: string
  /**
   * The link, returned once and never again.
   *
   * Only the hash is stored, so this is the single moment the raw token
   * exists anywhere we control. There is no "resend" that recovers it — a
   * manager who loses it revokes and invites again, which is the correct
   * behaviour for a bearer credential.
   */
  link?: string
  invitedEmail?: string
}

/** Who may add staff. Advisors cannot invite themselves a manager. */
function canManageStaff(role: string): boolean {
  return role === 'SERVICE_MANAGER' || role === 'ADMIN'
}

export async function inviteStaff(
  _previous: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const user = await requireUser()
  if (!canManageStaff(user.role)) {
    return { error: 'Only a service manager or administrator can invite staff.' }
  }

  const email = normaliseEmail(String(formData.get('email') ?? ''))
  const role = String(formData.get('role') ?? '')

  if (!email || !email.includes('@')) return { error: 'Enter a work email address.' }
  if (!isInvitableRole(role)) return { error: 'Pick a role from the list.' }

  const db = getDb()

  /*
    Already on staff here?

    Checked by email against this store's roster rather than globally: the same
    person legitimately holds accounts at two dealerships in a group, and
    refusing on that basis would block a real invitation.
  */
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .innerJoin(schema.userStoreRoles, eq(schema.userStoreRoles.userId, schema.users.id))
    .where(and(
      eq(schema.users.email, email),
      eq(schema.userStoreRoles.storeId, user.storeId),
      eq(schema.userStoreRoles.isActive, true),
    ))
    .limit(1)

  if (existing[0]) {
    return { error: `${email} already works at ${user.storeName}.` }
  }

  const { token, tokenHash } = createInviteToken()
  const now = new Date()

  /*
    Re-inviting replaces the pending link rather than adding a second one.

    A partial unique index enforces one live invitation per address per store,
    so this revokes first instead of colliding. Two working links for the same
    person is one more than anybody can keep track of.
  */
  await db.update(schema.storeInvitations)
    .set({ revokedAt: now, revokedByUserId: user.id })
    .where(and(
      eq(schema.storeInvitations.storeId, user.storeId),
      eq(schema.storeInvitations.email, email),
      isNull(schema.storeInvitations.acceptedAt),
      isNull(schema.storeInvitations.revokedAt),
    ))

  await db.insert(schema.storeInvitations).values({
    storeId: user.storeId,
    email,
    role,
    tokenHash,
    invitedByUserId: user.id,
    expiresAt: inviteExpiryFrom(now),
  })

  revalidatePath('/team')
  return { link: `/invite/${token}`, invitedEmail: email }
}

export async function revokeInvite(formData: FormData): Promise<void> {
  const user = await requireUser()
  if (!canManageStaff(user.role)) return

  const id = String(formData.get('invitationId') ?? '')
  if (!id) return

  // Scoped to the caller's store, so an id from another dealership matches
  // nothing rather than revoking their invitation.
  await getDb().update(schema.storeInvitations)
    .set({ revokedAt: new Date(), revokedByUserId: user.id })
    .where(and(
      eq(schema.storeInvitations.id, id),
      eq(schema.storeInvitations.storeId, user.storeId),
      isNull(schema.storeInvitations.acceptedAt),
    ))

  revalidatePath('/team')
}
