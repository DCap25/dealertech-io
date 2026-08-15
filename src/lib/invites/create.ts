import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope } from '@/db/scoped'
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
  /*
    Scoped, and it works for both callers. A service manager matches through
    their own store; a platform admin provisioning a brand-new dealership has
    no membership in it at all and matches through is_platform_admin(), which
    the invitation policy already allows for exactly this case.
  */
  const email = normaliseEmail(params.email)
  const now = new Date()

  /*
    One live invitation per address per store.

    A partial unique index enforces it, so this revokes any pending link first
    rather than colliding. Two working links for the same person is one more
    than anybody can keep track of.
  */
  const { token, tokenHash } = createInviteToken()

  // Revoke-then-issue is one act: a failure between them would leave the
  // address with no working link and no new one either.
  await withCurrentUserScope(async (db) => {
    await db.update(schema.storeInvitations)
      .set({ revokedAt: now, revokedByUserId: params.invitedByUserId })
      .where(and(
        eq(schema.storeInvitations.storeId, params.storeId),
        eq(schema.storeInvitations.email, email),
        isNull(schema.storeInvitations.acceptedAt),
        isNull(schema.storeInvitations.revokedAt),
      ))

    await db.insert(schema.storeInvitations).values({
      storeId: params.storeId,
      email,
      role: params.role,
      tokenHash,
      invitedByUserId: params.invitedByUserId,
      expiresAt: inviteExpiryFrom(now),
    })
  })

  return { token, email }
}
