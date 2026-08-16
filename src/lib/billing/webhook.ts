import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { getStripe } from './stripe'
import { applyTransition } from './store'
import {
  isHandled, isOurs, lifecycleEventFor, organizationIdOf, subscriptionIdFrom, toMirror,
} from './stripe-map'

/**
 * Applying a verified Stripe event.
 *
 * ---------------------------------------------------------------------------
 * THE TWO PROBLEMS THIS SOLVES, AND HOW
 * ---------------------------------------------------------------------------
 * **Duplicates.** Stripe retries, and a retry is byte-identical to the first
 * delivery. The unique constraint on `stripe_events.stripe_event_id` is the
 * whole mechanism: insert first, and a conflict means we have already seen it.
 * Nothing downstream needs to be idempotent, because nothing downstream runs
 * twice.
 *
 * **Ordering.** Webhooks do not arrive in order. A `customer.subscription.
 * updated` describing a cancellation can land after the `deleted` that
 * followed it, and acting on event payloads in the order they arrive would
 * leave the tenant in whichever state happened to be last down the wire.
 *
 * So this never reads state out of the event body. It takes the subscription
 * *id* from the event, re-fetches that subscription from Stripe, and acts on
 * what is true now. A re-fetch is current by definition, which makes ordering
 * irrelevant rather than something to reason about. It costs one API call per
 * event and buys away an entire class of bug.
 *
 * Runs privileged: there is no signed-in user behind a webhook. Same row of
 * the table in src/db/README.md as the scheduled jobs, and the reason
 * `stripe_events` carries no write policy at all.
 */

export type WebhookOutcome =
  | { status: 'duplicate' }
  | { status: 'ignored'; why: string }
  | { status: 'applied'; organizationId: string; from: string; to: string }
  | { status: 'noop'; why: string }
  | { status: 'failed'; why: string }

export interface IncomingEvent {
  id: string
  type: string
  livemode: boolean
  data: { object: unknown }
}

/**
 * Record the event, then act on it.
 *
 * Recording happens first and separately from acting, so a delivery is never
 * lost to a failure in our own logic: the raw payload is on disk before
 * anything tries to interpret it, and a handler bug becomes a replayable row
 * rather than an event Stripe gave up retrying three days ago.
 */
export async function handleStripeEvent(event: IncomingEvent): Promise<WebhookOutcome> {
  const db = getDb()

  const object = event.data?.object as Record<string, unknown> | undefined
  const relevant = isOurs(object as { metadata?: Record<string, string> })

  const inserted = await db
    .insert(schema.stripeEvents)
    .values({
      stripeEventId: event.id,
      eventType: event.type,
      livemode: event.livemode,
      payload: JSON.stringify(event),
      relevant,
    })
    .onConflictDoNothing({ target: schema.stripeEvents.stripeEventId })
    .returning({ id: schema.stripeEvents.id })

  // Nothing inserted means we have processed this delivery already.
  if (inserted.length === 0) return { status: 'duplicate' }
  const rowId = inserted[0]!.id

  const finish = async (outcome: WebhookOutcome): Promise<WebhookOutcome> => {
    await db.update(schema.stripeEvents)
      .set({
        processedAt: new Date(),
        error: outcome.status === 'failed' ? outcome.why : null,
      })
      .where(eq(schema.stripeEvents.id, rowId))
    return outcome
  }

  /*
    An object without our metadata.

    In a dedicated account this should be impossible, so it is recorded and
    reported rather than quietly skipped — it means something is pointed at the
    wrong account, which is worth finding out about on the first event rather
    than the hundredth.
  */
  if (!relevant) {
    return finish({
      status: 'ignored',
      why: 'Object carries no DealerTech metadata. Something may be pointed at the wrong Stripe account.',
    })
  }

  if (!isHandled(event.type)) {
    return finish({ status: 'ignored', why: `Unhandled event type ${event.type}.` })
  }

  const subscriptionId = subscriptionIdFrom(event.type, object)
  if (!subscriptionId) {
    // Normal for a one-off invoice, and for a checkout session that did not
    // create a subscription. Not an error.
    return finish({ status: 'noop', why: 'Event does not concern a subscription.' })
  }

  try {
    /*
      The re-fetch. See the header — this is what makes delivery order
      irrelevant, and it is deliberately not `event.data.object` even when the
      event carries a full subscription.
    */
    const fresh = await getStripe().subscriptions.retrieve(subscriptionId)

    const organizationId = organizationIdOf(fresh) ?? organizationIdOf(object as never)
    if (!organizationId) {
      return finish({
        status: 'failed',
        why: `Subscription ${subscriptionId} names no organization. It cannot be matched to a tenant.`,
      })
    }

    const mirror = toMirror(fresh as never)
    await upsertMirror(organizationId, mirror)

    const lifecycleEvent = lifecycleEventFor(mirror)
    if (!lifecycleEvent) {
      return finish({ status: 'noop', why: `Subscription is ${mirror.status}; nothing to move.` })
    }

    const moved = await applyTransition({
      organizationId,
      event: lifecycleEvent,
      actor: 'WEBHOOK',
      reason: `Stripe ${event.type} — subscription is ${mirror.status}.`,
    })

    /*
      A refused transition is a success, not a failure.

      The engine refuses anything its table does not permit, and the common
      cause is a tenant already being where the event would put them — a
      duplicate activation, a payment failure for an account somebody already
      comped. Returning 500 would have Stripe retry an event that is correctly
      doing nothing, forever.
    */
    if (!moved.ok) return finish({ status: 'noop', why: moved.reason })

    return finish({
      status: 'applied',
      organizationId,
      from: moved.from,
      to: moved.to,
    })
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    return finish({ status: 'failed', why })
  }
}

/**
 * Write the subscription mirror, creating the billing account if this is the
 * first time we have heard of it.
 *
 * A checkout completed by a tenant who has never paid before arrives with no
 * local billing account, because one is only created when there is something
 * to hold. Creating it here rather than at checkout time means the row exists
 * exactly when Stripe confirms it should, instead of whenever somebody opened
 * a payment page and wandered off.
 */
async function upsertMirror(
  organizationId: string,
  mirror: ReturnType<typeof toMirror>,
): Promise<void> {
  const db = getDb()

  await db.transaction(async (tx) => {
    const [existingAccount] = await tx
      .select({ id: schema.billingAccounts.id })
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.organizationId, organizationId))
      .limit(1)

    let billingAccountId = existingAccount?.id
    if (!billingAccountId) {
      const [created] = await tx.insert(schema.billingAccounts).values({
        organizationId,
        // Filled in properly by the console; a placeholder here would be a
        // plausible-looking wrong address to send invoices to.
        billingEmail: '',
        collectionMode: 'CARD',
      }).returning({ id: schema.billingAccounts.id })
      billingAccountId = created!.id
    }

    const [existing] = await tx
      .select({ id: schema.subscriptions.id })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.stripeSubscriptionId, mirror.stripeSubscriptionId))
      .limit(1)

    if (existing) {
      await tx.update(schema.subscriptions).set({
        status: mirror.status,
        rooftopQuantity: mirror.rooftopQuantity,
        currentPeriodEnd: mirror.currentPeriodEnd,
        cancelAtPeriodEnd: mirror.cancelAtPeriodEnd,
        trialEndsAt: mirror.trialEndsAt,
        updatedAt: new Date(),
      }).where(eq(schema.subscriptions.id, existing.id))
    } else {
      await tx.insert(schema.subscriptions).values({
        billingAccountId,
        stripeSubscriptionId: mirror.stripeSubscriptionId,
        planKey: 'STANDARD',
        status: mirror.status,
        rooftopQuantity: mirror.rooftopQuantity,
        currentPeriodEnd: mirror.currentPeriodEnd,
        cancelAtPeriodEnd: mirror.cancelAtPeriodEnd,
        trialEndsAt: mirror.trialEndsAt,
      })
    }
  })
}
