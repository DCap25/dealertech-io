import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { createInviteToken, inviteExpiryFrom, normaliseEmail, type InvitableRole } from './invite'

/**
 * Issue an invitation.
 *
 * Shared by the two places that create one — a manager adding an advisor, and
 * platform staff standing up a dealership from a lead — so both produce
 * identical links with identical lifetimes. A second implementation would have
 * drifted on the bit that matters least visibly and most: whether the raw token
 * is stored.
 *
 * Returns the raw token exactly once. Only its hash is persisted, so there is
 * nothing to recover afterwards and no "resend" that could recover it.
 */
export async function createInvitation(params: {
  storeId: string
  email: string
  role: InvitableRole
  invitedByUserId: string | null
}): Promise<{ token: string; email: string }> {
  const db = getDb()
  const email = normaliseEmail(params.email)
  const now = new Date()

  /*
    One live invitation per address per store.

    A partial unique index enforces it, so this revokes any pending link first
    rather than colliding. Two working links for the same person is one more
    than anybody can keep track of.
  */
  await db.update(schema.storeInvitations)
    .set({ revokedAt: now, revokedByUserId: params.invitedByUserId })
    .where(and(
      eq(schema.storeInvitations.storeId, params.storeId),
      eq(schema.storeInvitations.email, email),
      isNull(schema.storeInvitations.acceptedAt),
      isNull(schema.storeInvitations.revokedAt),
    ))

  const { token, tokenHash } = createInviteToken()

  await db.insert(schema.storeInvitations).values({
    storeId: params.storeId,
    email,
    role: params.role,
    tokenHash,
    invitedByUserId: params.invitedByUserId,
    expiresAt: inviteExpiryFrom(now),
  })

  return { token, email }
}
