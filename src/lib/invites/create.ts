import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope, type ScopedDb } from '@/db/scoped'
import { createInviteToken, inviteExpiryFrom, normaliseEmail, type InvitableRole } from './invite'

export interface NewInvitation {
  storeId: string
  email: string
  role: InvitableRole
  invitedByUserId: string | null
}

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
export async function createInvitation(
  params: NewInvitation,
): Promise<{ token: string; email: string }> {
  /*
    Scoped, and it works for both callers. A service manager matches through
    their own store; a platform admin provisioning a brand-new dealership has
    no membership in it at all and matches through is_platform_admin(), which
    the invitation policy already allows for exactly this case.
  */
  return withCurrentUserScope((db) => createInvitationOn(db, params))
}

/**
 * The same, on a transaction the caller already opened.
 *
 * Exported for `provisionFromLead`, which has to create the organisation, the
 * rooftop and this invitation as one act — a failure between them used to
 * leave an orphaned dealership nobody had been invited to. The wrapper above
 * cannot serve that: it opens a transaction of its own, and the pool is
 * `max: 1` behind a pooler, so a second connection while holding the first is
 * a deadlock rather than a slow query. Same shape as `nextRoNumberScoped`; see
 * src/db/README.md.
 *
 * Note which connection that caller hands in. Provisioning runs privileged —
 * `requirePlatformAdmin()` is doing the authorising, and there is no tenant to
 * belong to yet — so this insert bypasses the invitation policy rather than
 * matching through it. That is the same row of the README's table the rest of
 * provisioning sits on, and the policy path above is unchanged for everybody
 * else.
 */
export async function createInvitationOn(
  db: ScopedDb,
  params: NewInvitation,
): Promise<{ token: string; email: string }> {
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

  return { token, email }
}
