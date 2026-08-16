// Not `server-only`: reachable from a CLI when a group is reconciled by hand,
// and the guard throws outside a React Server Component context. The lesson
// from lib/billing/store.ts, which shipped with exactly that fault.
import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { getStripe } from './stripe'
import { toMirror } from './stripe-map'

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
    .orderBy(schema.subscriptionChanges.createdAt)
    .limit(limit)
}
