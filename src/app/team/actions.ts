'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { requireUser } from '@/lib/auth/session'
import { isInvitableRole, normaliseEmail } from '@/lib/invites/invite'
import { createInvitation } from '@/lib/invites/create'
import {
  canChangeRole, canManageStaff, canRemove, canRestore,
  type RosterMember, type StaffRole,
} from '@/lib/team/roster'

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

/**
 * The store's roster, for the guards to reason over.
 *
 * Read fresh inside each action rather than passed from the page. The page
 * rendered at some point in the past and these are POST endpoints — by the time
 * one runs, the last manager may already have been removed by somebody else.
 */
async function roster(storeId: string): Promise<RosterMember[]> {
  const rows = await getDb()
    .select({
      userId: schema.userStoreRoles.userId,
      role: schema.userStoreRoles.role,
      isActive: schema.userStoreRoles.isActive,
    })
    .from(schema.userStoreRoles)
    .where(eq(schema.userStoreRoles.storeId, storeId))
  return rows as RosterMember[]
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

  const { token } = await createInvitation({
    storeId: user.storeId,
    email,
    role,
    invitedByUserId: user.id,
  })

  revalidatePath('/team')
  return { link: `/invite/${token}`, invitedEmail: email }
}

export interface RosterState {
  error?: string
  ok?: string
}

/**
 * Take somebody off the roster.
 *
 * Deactivates the membership; it never deletes the person. An advisor who left
 * in March still wrote February's repair orders and still owns the declines
 * being followed up, so the name stays attached to the history and simply stops
 * being able to sign in.
 */
export async function removeStaff(
  _previous: RosterState,
  formData: FormData,
): Promise<RosterState> {
  const user = await requireUser()
  const targetUserId = String(formData.get('userId') ?? '')

  const verdict = canRemove(await roster(user.storeId), user.id, targetUserId)
  if (!verdict.ok) return { error: verdict.reason }

  await getDb().update(schema.userStoreRoles)
    .set({ isActive: false })
    .where(and(
      eq(schema.userStoreRoles.userId, targetUserId),
      // Scoped to this store: a manager at one rooftop must not be able to
      // remove somebody at another by posting their id.
      eq(schema.userStoreRoles.storeId, user.storeId),
    ))

  revalidatePath('/team')
  return { ok: 'Removed. Their history stays on the repair orders they wrote.' }
}

/** Put somebody back, for the advisor who returns after a season elsewhere. */
export async function restoreStaff(
  _previous: RosterState,
  formData: FormData,
): Promise<RosterState> {
  const user = await requireUser()
  const targetUserId = String(formData.get('userId') ?? '')

  const verdict = canRestore(await roster(user.storeId), user.id, targetUserId)
  if (!verdict.ok) return { error: verdict.reason }

  await getDb().update(schema.userStoreRoles)
    .set({ isActive: true })
    .where(and(
      eq(schema.userStoreRoles.userId, targetUserId),
      eq(schema.userStoreRoles.storeId, user.storeId),
    ))

  revalidatePath('/team')
  return { ok: 'Back on the roster.' }
}

export async function changeRole(
  _previous: RosterState,
  formData: FormData,
): Promise<RosterState> {
  const user = await requireUser()
  const targetUserId = String(formData.get('userId') ?? '')
  const nextRole = String(formData.get('role') ?? '')

  if (!isInvitableRole(nextRole)) return { error: 'Pick a role from the list.' }

  const verdict = canChangeRole(
    await roster(user.storeId), user.id, targetUserId, nextRole as StaffRole,
  )
  if (!verdict.ok) return { error: verdict.reason }

  await getDb().update(schema.userStoreRoles)
    .set({ role: nextRole })
    .where(and(
      eq(schema.userStoreRoles.userId, targetUserId),
      eq(schema.userStoreRoles.storeId, user.storeId),
    ))

  revalidatePath('/team')
  return { ok: 'Role updated.' }
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
