'use server'

import { revalidatePath } from 'next/cache'
import { addDays } from 'date-fns'
import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { requirePlatformAdmin } from '@/lib/auth/session'
import { applyTransition } from '@/lib/billing/store'
import {
  reverseCancellation, scheduleCancellation, setRooftopQuantity,
} from '@/lib/billing/subscription-ops'
import { putOnInvoiceRail } from '@/lib/billing/invoice-rail'
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

/**
 * End a free arrangement.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT THE CANCEL BUTTON
 * ---------------------------------------------------------------------------
 * A comp has nothing in Stripe, so there is no period to schedule against and
 * `scheduleCancellation` refuses it. This is the other half of that refusal:
 * the one commercial ending that is purely a decision.
 *
 * It fires COMP_ENDED rather than SUBSCRIPTION_CANCELED, which the console is
 * deliberately not permitted to fire at all — see the note in lifecycle.ts.
 * The engine restricts COMP_ENDED to a COMPED tenant, so there is no
 * precondition check here; writing one would be a second opinion about the
 * rule, and two opinions is how they drift apart.
 *
 * Lands in CANCELED, not CHURNED. They keep working through the ordinary
 * thirty days — a dealership on a comp still has customers booked in tomorrow.
 */
export async function endCompAccount(
  _previous: TenantActionState,
  formData: FormData,
): Promise<TenantActionState> {
  const admin = await requirePlatformAdmin()
  const organizationId = String(formData.get('organizationId') ?? '')
  const reason = reasonFrom(formData)
  if (!reason) {
    return { error: 'Say why the comp is ending. It is the counterpart to the reason it was granted.' }
  }
  return move(organizationId, 'COMP_ENDED', reason, admin.id)
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
 * Change how many rooftops a group is billed for.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A DELIBERATE ACT RATHER THAN A CONSEQUENCE
 * ---------------------------------------------------------------------------
 * The reconciler notices when the billed quantity and the active store count
 * disagree, and refuses to fix it — because a rooftop opened last week that
 * nobody added to the subscription and one deactivated during a dispute look
 * identical from the outside, and the two want opposite handling. This is the
 * other half of that decision: the place a human resolves it, having seen the
 * money involved.
 *
 * The preview is shown on the page before this runs, so nobody presses the
 * button without having read what it costs. Volume pricing means the answer is
 * sometimes counter-intuitive — 25 to 26 rooftops lowers the bill — and being
 * surprised by that on an invoice is exactly the failure the preview prevents.
 */
export async function changeRooftopQuantity(
  _previous: TenantActionState,
  formData: FormData,
): Promise<TenantActionState> {
  const admin = await requirePlatformAdmin()
  const organizationId = String(formData.get('organizationId') ?? '')
  const quantity = Number(formData.get('quantity') ?? 0)
  const reason = reasonFrom(formData)

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
    return { error: 'Enter a rooftop count between 1 and 500.' }
  }
  if (!reason) {
    return { error: 'Say why. A quantity change is what an invoice is built from, and "why is February different" is a question somebody will ask in March.' }
  }

  const result = await setRooftopQuantity(organizationId, quantity, {
    changedByUserId: admin.id,
    reason,
  })

  if (!result.ok) return { error: result.reason }

  revalidatePath(`/admin/tenants/${organizationId}`)
  return { ok: `Now billing for ${result.to} rooftop(s), was ${result.from}.` }
}

/**
 * Put a dealer group on invoiced billing with net terms.
 *
 * The sales-led rail. A franchise group has an accounts payable department, a
 * purchase order and terms; the person who signs has no authority to put
 * twenty thousand a month on a card and would not if they had.
 *
 * Deliberately does not touch the lifecycle status. Sending an invoice is not
 * being paid, and marking somebody ACTIVE here would be the same mistake as
 * trusting a checkout success page — the webhook moves them when the money
 * actually arrives.
 */
export async function setInvoiceRail(
  _previous: TenantActionState,
  formData: FormData,
): Promise<TenantActionState> {
  const admin = await requirePlatformAdmin()
  const organizationId = String(formData.get('organizationId') ?? '')
  const billingEmail = String(formData.get('billingEmail') ?? '').trim().toLowerCase()
  const billingName = String(formData.get('billingName') ?? '').trim()
  const poNumber = String(formData.get('poNumber') ?? '').trim()
  const netTermsDays = Number(formData.get('netTermsDays') ?? 30)
  const rooftops = Number(formData.get('rooftops') ?? 1)
  const reason = reasonFrom(formData)

  if (!billingEmail.includes('@')) {
    return { error: 'Enter the accounts payable email address — invoices go there, not to the person who signed.' }
  }
  if (!reason) return { error: 'Say what was agreed, and with whom.' }

  const result = await putOnInvoiceRail(
    organizationId,
    rooftops,
    {
      billingEmail,
      billingName: billingName || null,
      poNumber: poNumber || null,
      netTermsDays,
    },
    { changedByUserId: admin.id, reason },
  )

  if (!result.ok) return { error: result.reason }

  revalidatePath(`/admin/tenants/${organizationId}`)
  return {
    ok: result.invoiceUrl
      ? `On net-${netTermsDays} invoicing. First invoice: ${result.invoiceUrl}`
      : `On net-${netTermsDays} invoicing. Stripe will issue the first invoice at the start of the period.`,
  }
}

// ===========================================================================

/**
 * End the subscription when the period they paid for does.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A LIFECYCLE BUTTON
 * ---------------------------------------------------------------------------
 * Every other control on this page moves a status. This one deliberately moves
 * none: the dealership stays ACTIVE, keeps everything, and is billed exactly
 * once more. Stripe deletes the subscription when the period runs out and the
 * webhook does the transition then, which is what starts the churn clock from
 * the right moment rather than thirty days too early.
 *
 * The revalidation is wider than the tenant page on purpose. A group who has
 * given notice should stop looking healthy on the tenant list the moment
 * somebody records it — that list is what gets read on a Monday morning.
 */
export async function scheduleCancellationAction(
  _previous: TenantActionState,
  formData: FormData,
): Promise<TenantActionState> {
  const admin = await requirePlatformAdmin()
  const organizationId = String(formData.get('organizationId') ?? '')
  const reason = reasonFrom(formData)

  if (!reason) {
    return {
      error: 'Say why they are leaving. This is the only record of it, and it is the '
        + 'question every renewal conversation for the next year starts from.',
    }
  }

  const result = await scheduleCancellation(organizationId, {
    changedByUserId: admin.id,
    reason,
  })
  if (!result.ok) return { error: result.reason }

  revalidatePath(`/admin/tenants/${organizationId}`)
  revalidatePath('/admin/tenants')
  revalidatePath('/admin')

  return {
    ok: result.effectiveAt
      ? `Set to end on ${result.effectiveAt.toISOString().slice(0, 10)}. `
        + 'They keep working until then, and will be billed once more.'
      : 'Set to end when the current period does. Stripe will confirm the date on the next invoice.',
  }
}

/**
 * They changed their mind.
 *
 * No reason required, matching `reactivateAccount`. The reasons are demanded on
 * the acts that take something away — a restorative one that a support engineer
 * abandons because the form asked them a question is the worse outcome, and the
 * cancellation it reverses already carries the explanation of what happened.
 */
export async function reverseCancellationAction(
  _previous: TenantActionState,
  formData: FormData,
): Promise<TenantActionState> {
  const admin = await requirePlatformAdmin()
  const organizationId = String(formData.get('organizationId') ?? '')
  const reason = reasonFrom(formData) || 'Cancellation withdrawn.'

  const result = await reverseCancellation(organizationId, {
    changedByUserId: admin.id,
    reason,
  })
  if (!result.ok) return { error: result.reason }

  revalidatePath(`/admin/tenants/${organizationId}`)
  revalidatePath('/admin/tenants')
  revalidatePath('/admin')

  return { ok: 'The subscription will renew as normal. Nothing had lapsed, so nothing was rebuilt.' }
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
