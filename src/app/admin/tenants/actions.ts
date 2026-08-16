'use server'

import { revalidatePath } from 'next/cache'
import { addDays } from 'date-fns'
import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { requirePlatformAdmin } from '@/lib/auth/session'
import { applyTransition } from '@/lib/billing/store'
import { buildAuditRow } from '@/lib/audit/events'
import type { LifecycleEvent } from '@/lib/billing/lifecycle'

/**
 * The lifecycle controls on the tenant page.
 *
 * ---------------------------------------------------------------------------
 * EVERY ONE OF THESE IS THE SAME FOUR STEPS
 * ---------------------------------------------------------------------------
 * Authorise (platform admin, or nothing happens), decide (the pure engine
 * says whether the move is legal), record (status + lifecycle_events +
 * audit_log, in one transaction), revalidate.
 *
 * The engine is what makes these safe to expose as buttons. None of them
 * checks "is this tenant in the right state" for itself — `applyTransition`
 * re-reads the current status inside its transaction and refuses anything the
 * table in lifecycle.ts does not permit, so a stale page cannot suspend
 * somebody who paid thirty seconds ago.
 *
 * Reasons are required rather than optional on every discretionary act. A comp
 * with no reason is how a comp outlives the person who granted it.
 *
 * Runs privileged. A platform admin holds no role at the dealership they are
 * changing — that is the whole design of migration 0016 — so no store-scoped
 * policy can match, and `requirePlatformAdmin()` is doing the entire job of
 * authorising this. Same row of the table in src/db/README.md as tenant
 * provisioning.
 */

export interface TenantActionState {
  error?: string
  ok?: string
}

/** Long enough to be a sentence, short enough to stay readable in a list. */
const MAX_REASON = 500

function reasonFrom(formData: FormData): string {
  return String(formData.get('reason') ?? '').trim().slice(0, MAX_REASON)
}

async function move(
  organizationId: string,
  event: LifecycleEvent,
  reason: string,
  actorUserId: string,
  extra?: { trialEndsAt?: Date | null },
): Promise<TenantActionState> {
  const result = await applyTransition({
    organizationId,
    event,
    actor: 'PLATFORM_ADMIN',
    actorUserId,
    reason,
    ...extra,
  })

  if (!result.ok) return { error: result.reason }

  revalidatePath(`/admin/tenants/${organizationId}`)
  revalidatePath('/admin/tenants')
  revalidatePath('/admin')
  return { ok: `Moved from ${result.from} to ${result.to}.` }
}

export async function extendTrial(
  _previous: TenantActionState,
  formData: FormData,
): Promise<TenantActionState> {
  const admin = await requirePlatformAdmin()
  const organizationId = String(formData.get('organizationId') ?? '')
  const days = Number(formData.get('days') ?? 0)
  const reason = reasonFrom(formData)

  if (!Number.isInteger(days) || days < 1 || days > 180) {
    return { error: 'Extend by between 1 and 180 days.' }
  }
  if (!reason) return { error: 'Say why. A trial extension nobody explained is one nobody can review.' }

  /*
    Measured from today, not from the old deadline.

    Extending a trial that lapsed a fortnight ago by seven days would otherwise
    hand back a date already in the past, and the tenant would expire again on
    the next nightly run — which reads as the button not working.
  */
  return move(organizationId, 'TRIAL_EXTENDED', reason, admin.id, {
    trialEndsAt: addDays(new Date(), days),
  })
}

export async function compAccount(
  _previous: TenantActionState,
  formData: FormData,
): Promise<TenantActionState> {
  const admin = await requirePlatformAdmin()
  const organizationId = String(formData.get('organizationId') ?? '')
  const reason = reasonFrom(formData)
  if (!reason) {
    return { error: 'Say why this account is free. This is the record that stops a comp becoming permanent by accident.' }
  }
  return move(organizationId, 'COMPED_BY_ADMIN', reason, admin.id)
}

export async function suspendAccount(
  _previous: TenantActionState,
  formData: FormData,
): Promise<TenantActionState> {
  const admin = await requirePlatformAdmin()
  const organizationId = String(formData.get('organizationId') ?? '')
  const reason = reasonFrom(formData)
  if (!reason) return { error: 'Suspending a dealership requires a reason.' }

  /*
    The engine refuses this from anywhere but RESTRICTED, so there is no
    precondition check here — writing one would be a second opinion about the
    rule, and two opinions is how they drift apart. The refusal message
    explains the grace period, and it renders on the form.
  */
  return move(organizationId, 'SUSPENDED_BY_ADMIN', reason, admin.id)
}

export async function reactivateAccount(
  _previous: TenantActionState,
  formData: FormData,
): Promise<TenantActionState> {
  const admin = await requirePlatformAdmin()
  const organizationId = String(formData.get('organizationId') ?? '')
  const reason = reasonFrom(formData) || 'Reactivated by DealerTech.'
  return move(organizationId, 'REACTIVATED_BY_ADMIN', reason, admin.id)
}

export async function winBackAccount(
  _previous: TenantActionState,
  formData: FormData,
): Promise<TenantActionState> {
  const admin = await requirePlatformAdmin()
  const organizationId = String(formData.get('organizationId') ?? '')
  const reason = reasonFrom(formData)
  if (!reason) return { error: 'Say what changed. A win-back is a new relationship, not an undo.' }

  // A returning dealership starts a fresh trial rather than landing straight
  // in ACTIVE — there is no subscription behind them any more, and pretending
  // otherwise would make the reconciler report a missing one every night.
  return move(organizationId, 'WIN_BACK', reason, admin.id, {
    trialEndsAt: addDays(new Date(), 30),
  })
}

// ===========================================================================

/**
 * Support access: a role at a dealership, with a deadline.
 *
 * ---------------------------------------------------------------------------
 * THE ONLY DOOR, AND IT IS DELIBERATELY VISIBLE
 * ---------------------------------------------------------------------------
 * The console cannot read a dealership's customers. When a support question
 * genuinely requires looking at their data, this is how — by holding a role at
 * that store like anybody else, which puts a row in their roster that they can
 * see on their own team page.
 *
 * Three properties, all load-bearing:
 *  - It expires by itself. `expires_at` is enforced in `current_user_store_ids`
 *    (migration 0023) as well as in the session loader, so a forgotten grant
 *    stops working without anybody remembering it.
 *  - It is audited at the moment of granting, not merely visible afterwards.
 *  - It is not hidden from the dealership. Anyone arguing that support access
 *    should be invisible is arguing for the thing this design exists to refuse.
 */
const MAX_SUPPORT_HOURS = 72

export async function grantSupportAccess(
  _previous: TenantActionState,
  formData: FormData,
): Promise<TenantActionState> {
  const admin = await requirePlatformAdmin()
  const organizationId = String(formData.get('organizationId') ?? '')
  const storeId = String(formData.get('storeId') ?? '')
  const hours = Number(formData.get('hours') ?? 24)
  const reason = reasonFrom(formData)

  if (!storeId) return { error: 'Pick a rooftop.' }
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_SUPPORT_HOURS) {
    return { error: `Grant between 1 and ${MAX_SUPPORT_HOURS} hours.` }
  }
  if (!reason) return { error: 'Say which ticket or question this is for.' }

  const db = getDb()
  const expiresAt = new Date(Date.now() + hours * 3_600_000)

  try {
    await db.transaction(async (tx) => {
      /*
        ADVISOR, not ADMIN.

        Support needs to see the drive as an advisor sees it, which is what
        almost every question is actually about. Granting themselves the role
        that can also rewrite the roster would be taking more than the question
        requires, and the least surprising grant is the smallest one.
      */
      const existing = await tx
        .select({ id: schema.userStoreRoles.id })
        .from(schema.userStoreRoles)
        .where(and(
          eq(schema.userStoreRoles.userId, admin.id),
          eq(schema.userStoreRoles.storeId, storeId),
          eq(schema.userStoreRoles.role, 'ADVISOR'),
        ))
        .limit(1)

      if (existing[0]) {
        // Re-granting extends rather than stacking a second row that would
        // disagree with the first about when access ends.
        await tx.update(schema.userStoreRoles)
          .set({ isActive: true, expiresAt })
          .where(eq(schema.userStoreRoles.id, existing[0].id))
      } else {
        await tx.insert(schema.userStoreRoles).values({
          userId: admin.id,
          storeId,
          role: 'ADVISOR',
          isActive: true,
          expiresAt,
        })
      }

      const row = buildAuditRow({
        action: 'SUPPORT_ACCESS_GRANTED',
        entityType: 'user_store_roles',
        entityId: null,
        storeId,
        userId: admin.id,
        changes: { grantedTo: admin.email, hours, expiresAt: expiresAt.toISOString(), reason },
      })
      if (row) await tx.insert(schema.auditLog).values(row)
    })
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    return { error: `Could not grant access: ${why}` }
  }

  revalidatePath(`/admin/tenants/${organizationId}`)
  return { ok: `Access granted for ${hours}h. It lapses on its own at ${expiresAt.toISOString()}.` }
}

export async function revokeSupportAccess(
  _previous: TenantActionState,
  formData: FormData,
): Promise<TenantActionState> {
  const admin = await requirePlatformAdmin()
  const organizationId = String(formData.get('organizationId') ?? '')
  const roleId = String(formData.get('roleId') ?? '')
  if (!roleId) return { error: 'Nothing to revoke.' }

  const db = getDb()

  try {
    await db.transaction(async (tx) => {
      /*
        Expired, not deleted.

        Setting the deadline to now ends the access immediately and leaves the
        row, because "who could see this store last March" is the question the
        whole design exists to answer. A DELETE would answer it with silence.
      */
      const [updated] = await tx.update(schema.userStoreRoles)
        .set({ expiresAt: new Date(), isActive: false })
        .where(eq(schema.userStoreRoles.id, roleId))
        .returning({ storeId: schema.userStoreRoles.storeId })

      const row = buildAuditRow({
        action: 'SUPPORT_ACCESS_REVOKED',
        entityType: 'user_store_roles',
        entityId: roleId,
        storeId: updated?.storeId ?? null,
        userId: admin.id,
        changes: { revokedBy: admin.email },
      })
      if (row) await tx.insert(schema.auditLog).values(row)
    })
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    return { error: `Could not revoke: ${why}` }
  }

  revalidatePath(`/admin/tenants/${organizationId}`)
  return { ok: 'Access revoked.' }
}
