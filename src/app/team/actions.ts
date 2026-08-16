'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope } from '@/db/scoped'
import { recordAudit } from '@/lib/audit/record'
import { checkAccess, requireUser } from '@/lib/auth/session'
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
  const rows = await withCurrentUserScope((db) => db
    .select({
      userId: schema.userStoreRoles.userId,
      role: schema.userStoreRoles.role,
      isActive: schema.userStoreRoles.isActive,
    })
    .from(schema.userStoreRoles)
    .where(eq(schema.userStoreRoles.storeId, storeId)))
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

  /*
    Checked after the role, before anything is written.

    Order matters for the message a manager reads: "you are not allowed to do
    this" and "the account needs attention first" are different problems with
    different fixes, and reporting the billing one to somebody who could not
    have invited staff anyway would send them chasing an invoice for nothing.
  */
  const access = await checkAccess('INVITE_STAFF')
  if (!access.allowed) return { error: access.error }

  const email = normaliseEmail(String(formData.get('email') ?? ''))
  const role = String(formData.get('role') ?? '')

  if (!email || !email.includes('@')) return { error: 'Enter a work email address.' }
  if (!isInvitableRole(role)) return { error: 'Pick a role from the list.' }

  /*
    Already on staff here?

    Checked by email against this store's roster rather than globally: the same
    person legitimately holds accounts at two dealerships in a group, and
    refusing on that basis would block a real invitation.
  */
  const existing = await withCurrentUserScope((db) => db
    .select({ id: schema.users.id })
    .from(schema.users)
    .innerJoin(schema.userStoreRoles, eq(schema.userStoreRoles.userId, schema.users.id))
    .where(and(
      eq(schema.users.email, email),
      eq(schema.userStoreRoles.storeId, user.storeId),
      eq(schema.userStoreRoles.isActive, true),
    ))
    .limit(1))

  if (existing[0]) {
    return { error: `${email} already works at ${user.storeName}.` }
  }

  const { token } = await createInvitation({
    storeId: user.storeId,
    email,
    role,
    invitedByUserId: user.id,
  })

  /*
    The address and role, never the token. The link is a bearer credential and
    this table is append-only and permanent — a token written here stays valid
    and readable for as long as the log does. `sanitiseChanges` would redact it
    anyway; not passing it is the belt to that brace.
  */
  await withCurrentUserScope((db) => recordAudit(db, {
    action: 'STAFF_INVITED',
    entityType: 'store_invitations',
    entityId: null,
    storeId: user.storeId,
    userId: user.id,
    changes: { email, role },
  }))

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

  await withCurrentUserScope(async (db) => {
    await db.update(schema.userStoreRoles)
      .set({ isActive: false })
      .where(and(
        eq(schema.userStoreRoles.userId, targetUserId),
        // Scoped to this store: a manager at one rooftop must not be able to
        // remove somebody at another by posting their id.
        eq(schema.userStoreRoles.storeId, user.storeId),
      ))

    await recordAudit(db, {
      action: 'STAFF_REMOVED',
      entityType: 'user_store_roles',
      entityId: targetUserId,
      storeId: user.storeId,
      userId: user.id,
      changes: { isActive: { from: true, to: false } },
    })
  })

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

  await withCurrentUserScope(async (db) => {
    await db.update(schema.userStoreRoles)
      .set({ isActive: true })
      .where(and(
        eq(schema.userStoreRoles.userId, targetUserId),
        eq(schema.userStoreRoles.storeId, user.storeId),
      ))

    await recordAudit(db, {
      action: 'STAFF_RESTORED',
      entityType: 'user_store_roles',
      entityId: targetUserId,
      storeId: user.storeId,
      userId: user.id,
      changes: { isActive: { from: false, to: true } },
    })
  })

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

  const previousRole = (await roster(user.storeId))
    .find((m) => m.userId === targetUserId)?.role ?? null

  await withCurrentUserScope(async (db) => {
    await db.update(schema.userStoreRoles)
      .set({ role: nextRole })
      .where(and(
        eq(schema.userStoreRoles.userId, targetUserId),
        eq(schema.userStoreRoles.storeId, user.storeId),
      ))

    /*
      Both sides recorded. "Became a service manager" is only meaningful next
      to what they were before it, and the row itself keeps no history — the
      previous role is gone the moment this update lands.
    */
    await recordAudit(db, {
      action: 'STAFF_ROLE_CHANGED',
      entityType: 'user_store_roles',
      entityId: targetUserId,
      storeId: user.storeId,
      userId: user.id,
      changes: { role: { from: previousRole, to: nextRole } },
    })
  })

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
  await withCurrentUserScope(async (db) => {
    await db.update(schema.storeInvitations)
      .set({ revokedAt: new Date(), revokedByUserId: user.id })
      .where(and(
        eq(schema.storeInvitations.id, id),
        eq(schema.storeInvitations.storeId, user.storeId),
        isNull(schema.storeInvitations.acceptedAt),
      ))

    await recordAudit(db, {
      action: 'STAFF_INVITE_REVOKED',
      entityType: 'store_invitations',
      entityId: id,
      storeId: user.storeId,
      userId: user.id,
    })
  })

  revalidatePath('/team')
}
