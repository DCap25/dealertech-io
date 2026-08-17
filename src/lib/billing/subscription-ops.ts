// Not `server-only`: reachable from a CLI when a group is reconciled by hand,
// and the guard throws outside a React Server Component context. The lesson
// from lib/billing/store.ts, which shipped with exactly that fault.
import { desc, eq } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
/*
  The pure builder, not `recordAudit` from @/lib/audit/record — that wrapper is
  marked `server-only` and this module has to stay reachable from a CLI. Same
  reasoning, at more length, in the header of ./store.ts.
*/
import { buildAuditRow } from '@/lib/audit/events'
import type { AuditAction } from '@/lib/audit/events'
import { getStripe } from './stripe'
import { toMirror } from './stripe-map'
import {
  planCancellation, planReversal, type CancellationSubject, type SubscriptionStatus,
} from './cancellation'

/**
 * Changing a subscription, and remembering that somebody did.
 *
 * ---------------------------------------------------------------------------
 * WHY `subscription_changes` EXISTS AND WHY IT MUST NOT STAY EMPTY
 * ---------------------------------------------------------------------------
 * `lifecycle_events` records that a tenant moved between commercial states.
 * This records what was done to the commercial arrangement itself: quantity
 * moved from eight rooftops to nine, a plan was comped, a cancellation was
 * scheduled — with who did it and why.
 *
 * The table shipped with the billing schema and nothing wrote to it for two
 * phases, which is exactly how a design decision quietly becomes dead weight.
 * It matters most in the conversation nobody plans for: a dealer group asking
 * in March why their February invoice was different, when the person who
 * changed it has left. A row here answers that; an audit line saying
 * "subscription updated" does not.
 *
 * Reasons are required for anything a human initiates, for the same reason
 * comps require one — an unexplained change becomes permanent by default.
 */

export type ChangeKind =
  | 'QUANTITY'
  | 'PLAN'
  | 'COLLECTION_MODE'
  | 'CANCEL_SCHEDULED'
  | 'CANCEL_REVERSED'

export interface RecordedChange {
  subscriptionId: string
  kind: ChangeKind
  before: unknown
  after: unknown
  changedByUserId?: string | null
  reason?: string | null
}

/**
 * Write one commercial-history row.
 *
 * Takes a transaction handle so it commits with the change it describes. A
 * history that records something the database did not do is worse than no
 * history, because it will be believed.
 */
export async function recordChange(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  change: RecordedChange,
): Promise<void> {
  await tx.insert(schema.subscriptionChanges).values({
    subscriptionId: change.subscriptionId,
    kind: change.kind,
    before: JSON.stringify(change.before ?? null),
    after: JSON.stringify(change.after ?? null),
    changedByUserId: change.changedByUserId ?? null,
    reason: change.reason ?? null,
  })
}

export type QuantityResult =
  | { ok: true; from: number; to: number }
  | { ok: false; reason: string }

/**
 * Set the number of rooftops a group is billed for.
 *
 * ---------------------------------------------------------------------------
 * STRIPE FIRST, THEN OUR TABLES
 * ---------------------------------------------------------------------------
 * The order is deliberate and it is the safe one. If Stripe accepts the change
 * and our write then fails, the nightly reconciler notices the drift and
 * corrects the mirror — a self-healing inconsistency. If we wrote first and
 * Stripe failed, we would believe we were billing for nine rooftops while
 * invoicing eight, and nothing would ever notice, because the mirror would
 * agree with itself.
 *
 * Between the two, the failure that repairs itself is the one to choose.
 */
export async function setRooftopQuantity(
  organizationId: string,
  quantity: number,
  opts: { changedByUserId?: string | null; reason?: string | null } = {},
): Promise<QuantityResult> {
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { ok: false, reason: 'A subscription bills for at least one rooftop.' }
  }

  const db = getDb()

  const [row] = await db
    .select({
      id: schema.subscriptions.id,
      stripeSubscriptionId: schema.subscriptions.stripeSubscriptionId,
      rooftopQuantity: schema.subscriptions.rooftopQuantity,
      status: schema.subscriptions.status,
    })
    .from(schema.subscriptions)
    .innerJoin(
      schema.billingAccounts,
      eq(schema.billingAccounts.id, schema.subscriptions.billingAccountId),
    )
    .where(eq(schema.billingAccounts.organizationId, organizationId))
    .limit(1)

  if (!row) return { ok: false, reason: 'This dealer group has no subscription to change.' }
  if (row.status === 'COMPED' || !row.stripeSubscriptionId) {
    /*
      A comped account has no Stripe counterpart, so there is no quantity to
      push. Refused rather than silently updating only our mirror, which would
      make the reconciler report drift against a subscription that does not
      exist.
    */
    return { ok: false, reason: 'This account is comped and has no subscription in Stripe.' }
  }
  if (row.rooftopQuantity === quantity) {
    return { ok: false, reason: `Already billing for ${quantity} rooftop(s).` }
  }

  const stripe = getStripe()

  let fresh
  try {
    const subscription = await stripe.subscriptions.retrieve(row.stripeSubscriptionId)
    const item = subscription.items?.data?.[0]
    if (!item) return { ok: false, reason: 'That Stripe subscription has no billable item.' }

    await stripe.subscriptionItems.update(item.id, {
      quantity,
      /*
        Prorate, and invoice the difference on the next bill rather than
        charging a card immediately.

        A dealership opening a rooftop on the 14th should see the adjustment
        on their normal invoice, not an unexpected charge that day. It also
        keeps the card and invoice rails behaving identically, which is the
        whole point of running both through one pipeline.
      */
      proration_behavior: 'create_prorations',
    })

    fresh = await stripe.subscriptions.retrieve(row.stripeSubscriptionId)
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    return { ok: false, reason: `Stripe refused the change, so nothing was altered: ${why}` }
  }

  const mirror = toMirror(fresh as never)

  await db.transaction(async (tx) => {
    await tx.update(schema.subscriptions).set({
      rooftopQuantity: mirror.rooftopQuantity,
      status: mirror.status,
      currentPeriodEnd: mirror.currentPeriodEnd,
      updatedAt: new Date(),
    }).where(eq(schema.subscriptions.id, row.id))

    await recordChange(tx, {
      subscriptionId: row.id,
      kind: 'QUANTITY',
      before: { rooftops: row.rooftopQuantity },
      after: { rooftops: mirror.rooftopQuantity },
      changedByUserId: opts.changedByUserId,
      reason: opts.reason,
    })
  })

  return { ok: true, from: row.rooftopQuantity, to: mirror.rooftopQuantity }
}

// ===========================================================================

export type CancellationResult =
  | { ok: true; scheduled: boolean; effectiveAt: Date | null }
  | { ok: false; reason: string }

/**
 * Set — or clear — the flag that ends a subscription when the paid period does.
 *
 * ---------------------------------------------------------------------------
 * ONE FUNCTION FOR BOTH DIRECTIONS
 * ---------------------------------------------------------------------------
 * Scheduling and un-scheduling are the same Stripe call with a different
 * boolean, the same mirror write and the same history row with a different
 * kind. Writing them twice would be two chances to get the Stripe-first
 * ordering wrong, and the second copy is the one that would be missed when the
 * first is fixed.
 *
 * Stripe first, then our tables — the same choice `setRooftopQuantity` makes
 * above and for the same reason. If Stripe accepts and our write fails, the
 * nightly reconciler sees CANCEL_FLAG_DRIFT and repairs the mirror. If we wrote
 * first and Stripe failed, the console would show a cancellation that is not
 * booked anywhere, the dealership would be billed again, and nothing would
 * notice — the mirror would agree with itself.
 *
 * What this deliberately does NOT do is touch the lifecycle status. See the
 * header of ./cancellation.ts: moving a tenant to CANCELED here starts the
 * thirty-day churn clock against a period they have already paid for. Stripe
 * deletes the subscription when the period actually ends, and the webhook
 * fires the transition then.
 */
async function setCancelAtPeriodEnd(
  organizationId: string,
  next: boolean,
  opts: { changedByUserId?: string | null; reason?: string | null } = {},
): Promise<CancellationResult> {
  const db = getDb()

  const [row] = await db
    .select({
      id: schema.subscriptions.id,
      stripeSubscriptionId: schema.subscriptions.stripeSubscriptionId,
      status: schema.subscriptions.status,
      cancelAtPeriodEnd: schema.subscriptions.cancelAtPeriodEnd,
      currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
    })
    .from(schema.subscriptions)
    .innerJoin(
      schema.billingAccounts,
      eq(schema.billingAccounts.id, schema.subscriptions.billingAccountId),
    )
    .where(eq(schema.billingAccounts.organizationId, organizationId))
    .limit(1)

  if (!row) return { ok: false, reason: 'This dealer group has no subscription to change.' }

  const subject: CancellationSubject = {
    stripeSubscriptionId: row.stripeSubscriptionId,
    status: row.status as SubscriptionStatus,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    currentPeriodEnd: row.currentPeriodEnd,
  }

  const plan = next ? planCancellation(subject) : planReversal(subject)
  if (!plan.ok) return { ok: false, reason: plan.reason }

  // Narrowed by the plan — both refuse a null id — but asserted rather than
  // assumed, because the two files could drift apart later.
  const stripeSubscriptionId = row.stripeSubscriptionId
  if (!stripeSubscriptionId) {
    return { ok: false, reason: 'This subscription has no Stripe counterpart.' }
  }

  let mirror
  try {
    /*
      `update` returns the subscription it changed, so there is no re-fetch
      here — unlike the quantity path, which has to ask again because
      `subscriptionItems.update` hands back an item.
    */
    const updated = await getStripe().subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: next,
    })
    mirror = toMirror(updated as never)
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    return { ok: false, reason: `Stripe refused the change, so nothing was altered: ${why}` }
  }

  const kind = next ? 'CANCEL_SCHEDULED' : 'CANCEL_REVERSED'
  const action: AuditAction = next
    ? 'SUBSCRIPTION_CANCEL_SCHEDULED'
    : 'SUBSCRIPTION_CANCEL_REVERSED'

  await db.transaction(async (tx) => {
    await tx.update(schema.subscriptions).set({
      cancelAtPeriodEnd: mirror.cancelAtPeriodEnd,
      status: mirror.status,
      currentPeriodEnd: mirror.currentPeriodEnd,
      updatedAt: new Date(),
    }).where(eq(schema.subscriptions.id, row.id))

    await recordChange(tx, {
      subscriptionId: row.id,
      kind,
      before: { cancelAtPeriodEnd: row.cancelAtPeriodEnd },
      after: {
        cancelAtPeriodEnd: mirror.cancelAtPeriodEnd,
        effectiveAt: mirror.currentPeriodEnd?.toISOString() ?? null,
      },
      changedByUserId: opts.changedByUserId,
      reason: opts.reason,
    })

    /*
      Audited as well as recorded, per SAAS_PLAN §7 — every console mutation
      leaves an audit row. `subscription_changes` above answers "what did the
      arrangement look like in March"; this answers "who touched what" across
      the whole product. storeId is null: ending a subscription is an
      organization-level act, and naming one rooftop would imply the others
      were untouched.
    */
    const auditRow = buildAuditRow({
      action,
      entityType: 'subscriptions',
      entityId: row.id,
      storeId: null,
      userId: opts.changedByUserId ?? null,
      changes: {
        organizationId,
        stripeSubscriptionId,
        effectiveAt: mirror.currentPeriodEnd?.toISOString() ?? null,
        reason: opts.reason ?? null,
      },
    })
    if (auditRow) {
      /*
        Swallowed, matching `recordAudit` and `applyTransition`. The audit log
        is a record of the work, not a precondition for it — an unanticipated
        constraint must not roll back a cancellation Stripe has already
        accepted, which would leave the mirror disagreeing with Stripe for no
        reason anybody could see.
      */
      try {
        await tx.insert(schema.auditLog).values(auditRow)
      } catch (error) {
        console.error(`[audit] could not record ${action}:`, error)
      }
    }
  })

  return {
    ok: true,
    scheduled: mirror.cancelAtPeriodEnd,
    effectiveAt: mirror.currentPeriodEnd,
  }
}

/**
 * End this subscription when the period they have paid for runs out.
 *
 * Not immediately, and there is deliberately no option to make it immediate.
 * Cutting a dealership off on the day they cancel charges for time that is not
 * delivered, and it is the last impression the product leaves — see the
 * CANCELED arm of `resolveAccess`, which is written for exactly this.
 */
export function scheduleCancellation(
  organizationId: string,
  opts: { changedByUserId?: string | null; reason?: string | null } = {},
): Promise<CancellationResult> {
  return setCancelAtPeriodEnd(organizationId, true, opts)
}

/** They changed their mind. Nothing had happened yet, so nothing is undone. */
export function reverseCancellation(
  organizationId: string,
  opts: { changedByUserId?: string | null; reason?: string | null } = {},
): Promise<CancellationResult> {
  return setCancelAtPeriodEnd(organizationId, false, opts)
}

// ===========================================================================

/** The commercial history of a group's subscription, newest first. */
export async function changeHistory(organizationId: string, limit = 25) {
  const db = getDb()
  return db
    .select({
      id: schema.subscriptionChanges.id,
      kind: schema.subscriptionChanges.kind,
      before: schema.subscriptionChanges.before,
      after: schema.subscriptionChanges.after,
      reason: schema.subscriptionChanges.reason,
      createdAt: schema.subscriptionChanges.createdAt,
      actorName: schema.users.fullName,
    })
    .from(schema.subscriptionChanges)
    .innerJoin(
      schema.subscriptions,
      eq(schema.subscriptions.id, schema.subscriptionChanges.subscriptionId),
    )
    .innerJoin(
      schema.billingAccounts,
      eq(schema.billingAccounts.id, schema.subscriptions.billingAccountId),
    )
    .leftJoin(schema.users, eq(schema.users.id, schema.subscriptionChanges.changedByUserId))
    .where(eq(schema.billingAccounts.organizationId, organizationId))
    /*
      Newest first, and the `desc` is load-bearing rather than cosmetic.

      This read ascending, which with a limit meant the console showed the
      OLDEST twenty-five changes — so the moment a group had more than that,
      the most recent thing done to their subscription stopped being on the
      page. Reading a stale list as the current arrangement is the failure this
      table exists to prevent. `lifecycleHistory` next door had it right.
    */
    .orderBy(desc(schema.subscriptionChanges.createdAt))
    .limit(limit)
}
