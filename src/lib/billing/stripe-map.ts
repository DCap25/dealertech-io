import type { LifecycleEvent } from './lifecycle'

/**
 * Translating Stripe into our vocabulary.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS PURE, AND SEPARATE FROM THE HANDLER
 * ---------------------------------------------------------------------------
 * The webhook handler is I/O — verify a signature, write a row, call an API.
 * Deciding what a Stripe object *means* is a judgement, and judgements in this
 * codebase are pure functions with tests. Splitting them means the awkward
 * cases — a subscription that is `active` but cancelling, an event type we do
 * not handle, an object from the wrong account — can be proved against fixture
 * payloads instead of by pointing Stripe at a laptop.
 *
 * Deliberately typed against a structural subset rather than Stripe's own
 * types. A webhook payload is JSON that arrived over the wire; treating it as
 * a fully-typed `Stripe.Subscription` asserts a shape nobody validated. What
 * this needs is five fields, so it asks for five fields.
 */

/** Stamped on everything we create, so any object's origin is unambiguous. */
export const APP_METADATA_KEY = 'app'
export const APP_METADATA_VALUE = 'dealertech'
export const ORG_METADATA_KEY = 'organization_id'

interface WithMetadata {
  metadata?: Record<string, string> | null
}

/**
 * Did we create this?
 *
 * In a dedicated account the answer should always be yes, which is exactly why
 * it is checked. A `false` here means something is pointed at the wrong
 * account — a stray key, a webhook endpoint copied between environments — and
 * that is worth an alert rather than a silent skip.
 */
export function isOurs(object: WithMetadata | null | undefined): boolean {
  return object?.metadata?.[APP_METADATA_KEY] === APP_METADATA_VALUE
}

/** The tenant a Stripe object belongs to, if it says. */
export function organizationIdOf(object: WithMetadata | null | undefined): string | null {
  const value = object?.metadata?.[ORG_METADATA_KEY]
  return value && value.length > 0 ? value : null
}

/** The metadata every object we create carries. */
export function ourMetadata(organizationId: string): Record<string, string> {
  return {
    [APP_METADATA_KEY]: APP_METADATA_VALUE,
    [ORG_METADATA_KEY]: organizationId,
  }
}

// ===========================================================================

/** The subset of a Stripe subscription this application actually reads. */
export interface StripeSubscriptionLike {
  id: string
  status: string
  cancel_at_period_end?: boolean | null
  trial_end?: number | null
  metadata?: Record<string, string> | null
  items?: {
    data?: {
      quantity?: number | null
      current_period_end?: number | null
    }[]
  }
}

/** Our local mirror columns, derived from a subscription. */
export interface SubscriptionMirror {
  stripeSubscriptionId: string
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED'
  rooftopQuantity: number
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  trialEndsAt: Date | null
}

/**
 * Stripe's subscription statuses, collapsed onto ours.
 *
 * Stripe has more states than this product needs a distinction for:
 *
 *  - `incomplete` and `incomplete_expired` describe a subscription whose very
 *    first payment never completed. Nobody ever had access, so treating them
 *    as CANCELED is the truthful mapping — TRIALING would grant a tenant the
 *    product on the strength of a payment that failed.
 *  - `unpaid` is what a subscription becomes after dunning gives up. Also
 *    CANCELED: Stripe has stopped trying, and our own ladder has been running
 *    its fourteen days in parallel.
 *  - `paused` we do not use. Mapped to PAST_DUE rather than CANCELED so that
 *    if it ever appears, the tenant keeps working while somebody investigates.
 *    The fail-open direction, deliberately.
 */
function mapStatus(stripeStatus: string): SubscriptionMirror['status'] {
  switch (stripeStatus) {
    case 'trialing': return 'TRIALING'
    case 'active': return 'ACTIVE'
    case 'past_due': return 'PAST_DUE'
    case 'paused': return 'PAST_DUE'
    case 'canceled':
    case 'unpaid':
    case 'incomplete':
    case 'incomplete_expired':
      return 'CANCELED'
    default:
      /*
        An unrecognised status.

        PAST_DUE, not CANCELED. An unknown state is our ignorance, not the
        dealership's fault, and PAST_DUE keeps them working through fourteen
        days of grace — long enough for somebody to notice and decide.
      */
      return 'PAST_DUE'
  }
}

function secondsToDate(seconds: number | null | undefined): Date | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null
  return new Date(seconds * 1000)
}

/**
 * A subscription as our tables hold it.
 *
 * Quantity and period end come off the first subscription item rather than the
 * subscription: Stripe moved `current_period_end` onto items, and a
 * single-item subscription — which is all this product creates — carries both
 * there.
 */
export function toMirror(subscription: StripeSubscriptionLike): SubscriptionMirror {
  const item = subscription.items?.data?.[0]

  return {
    stripeSubscriptionId: subscription.id,
    status: mapStatus(subscription.status),
    /*
      Defaults to one rooftop rather than zero.

      A subscription with no quantity is malformed, and mirroring it as zero
      would make the reconciler report drift against every real rooftop the
      group has — noise on the one screen that exists to show real problems.
    */
    rooftopQuantity: item?.quantity ?? 1,
    currentPeriodEnd: secondsToDate(item?.current_period_end),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    trialEndsAt: secondsToDate(subscription.trial_end),
  }
}

// ===========================================================================

/**
 * What a mirrored subscription means for the tenant's lifecycle.
 *
 * Derived from the subscription's current state rather than from the event
 * type, and that is the whole design: webhook deliveries arrive out of order,
 * so "what happened" is unreliable while "what is true now" is not. The
 * handler re-fetches the subscription and asks this.
 *
 * Returns null when nothing should move — which is most of the time, and is
 * why the lifecycle engine refuses rather than throws on a no-op transition.
 */
export function lifecycleEventFor(mirror: SubscriptionMirror): LifecycleEvent | null {
  switch (mirror.status) {
    case 'ACTIVE':
      return 'SUBSCRIPTION_ACTIVATED'
    case 'PAST_DUE':
      return 'PAYMENT_FAILED'
    case 'CANCELED':
      return 'SUBSCRIPTION_CANCELED'
    case 'TRIALING':
      /*
        Nothing to do.

        A subscription in its trial does not move a tenant: they are already
        TRIAL from provisioning, and firing SUBSCRIPTION_ACTIVATED here would
        mark them ACTIVE before a single payment succeeded — which is exactly
        the state the invoice.paid event exists to signal.
      */
      return null
    default:
      return null
  }
}

/** Event types the endpoint subscribes to. Anything else is stored and ignored. */
export const HANDLED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.marked_uncollectible',
] as const

export type HandledEvent = (typeof HANDLED_EVENTS)[number]

export function isHandled(eventType: string): eventType is HandledEvent {
  return (HANDLED_EVENTS as readonly string[]).includes(eventType)
}

/**
 * The subscription id an event points at, wherever it happens to keep it.
 *
 * Three shapes across the event types we handle, and none of them is
 * documented in the same place: a checkout session names it, an invoice used
 * to carry it top-level and now hangs it off a line item's parent, and a
 * subscription event *is* it. Returning null is normal — an invoice for
 * something other than a subscription is not an error.
 */
export function subscriptionIdFrom(eventType: string, object: unknown): string | null {
  const o = object as Record<string, unknown> | null
  if (!o) return null

  if (eventType.startsWith('customer.subscription.')) {
    return typeof o.id === 'string' ? o.id : null
  }

  if (eventType === 'checkout.session.completed') {
    const sub = o.subscription
    if (typeof sub === 'string') return sub
    if (sub && typeof sub === 'object' && typeof (sub as { id?: unknown }).id === 'string') {
      return (sub as { id: string }).id
    }
    return null
  }

  if (eventType.startsWith('invoice.')) {
    // Top-level first, for older payload shapes and for anything replayed from
    // a stored event; then the line item's parent, which is where current
    // API versions put it.
    const direct = o.subscription
    if (typeof direct === 'string') return direct
    if (direct && typeof direct === 'object' && typeof (direct as { id?: unknown }).id === 'string') {
      return (direct as { id: string }).id
    }

    const lines = (o.lines as { data?: unknown[] } | undefined)?.data
    for (const line of lines ?? []) {
      const parent = (line as Record<string, unknown>)?.parent as Record<string, unknown> | undefined
      const details = parent?.subscription_item_details as Record<string, unknown> | undefined
      if (typeof details?.subscription === 'string') return details.subscription
    }
    return null
  }

  return null
}
