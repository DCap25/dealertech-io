import { describe, expect, it } from 'vitest'
import {
  isHandled, isOurs, lifecycleEventFor, organizationIdOf, ourMetadata,
  subscriptionIdFrom, toMirror, type StripeSubscriptionLike,
} from './stripe-map'

/**
 * Translating Stripe into our vocabulary.
 *
 * Fixture-driven, because the awkward cases here are all shapes that arrive
 * over the wire: a subscription that is active but cancelling, an invoice that
 * hides the subscription id three levels down, a status Stripe added after we
 * shipped. Each one is cheaper to prove here than to discover in production.
 */

const ORG = '11111111-2222-3333-4444-555555555555'

function subscription(over: Partial<StripeSubscriptionLike> = {}): StripeSubscriptionLike {
  return {
    id: 'sub_test',
    status: 'active',
    metadata: ourMetadata(ORG),
    items: { data: [{ quantity: 3, current_period_end: 1_800_000_000 }] },
    ...over,
  }
}

describe('provenance', () => {
  it('recognises an object we created', () => {
    expect(isOurs(subscription())).toBe(true)
    expect(organizationIdOf(subscription())).toBe(ORG)
  })

  it('rejects an object carrying no metadata, or somebody else’s', () => {
    expect(isOurs({ metadata: {} })).toBe(false)
    expect(isOurs({ metadata: { app: 'das_board' } })).toBe(false)
    expect(isOurs(null)).toBe(false)
    expect(isOurs(undefined)).toBe(false)
  })

  it('treats an empty organization id as absent', () => {
    // An empty string would sail through a truthiness check and then fail a
    // uuid lookup somewhere much further from the cause.
    expect(organizationIdOf({ metadata: { organization_id: '' } })).toBeNull()
  })
})

describe('mirroring a subscription', () => {
  it('reads quantity and period end off the subscription item', () => {
    const mirror = toMirror(subscription())
    expect(mirror.rooftopQuantity).toBe(3)
    expect(mirror.currentPeriodEnd).toEqual(new Date(1_800_000_000 * 1000))
    expect(mirror.status).toBe('ACTIVE')
  })

  it('maps every Stripe status we can actually receive', () => {
    const cases: [string, string][] = [
      ['trialing', 'TRIALING'],
      ['active', 'ACTIVE'],
      ['past_due', 'PAST_DUE'],
      ['canceled', 'CANCELED'],
      ['unpaid', 'CANCELED'],
      ['incomplete', 'CANCELED'],
      ['incomplete_expired', 'CANCELED'],
      ['paused', 'PAST_DUE'],
    ]
    for (const [stripeStatus, expected] of cases) {
      expect(toMirror(subscription({ status: stripeStatus })).status).toBe(expected)
    }
  })

  it('never grants access on a subscription whose first payment failed', () => {
    // `incomplete` means nobody ever paid. Mapping it anywhere but CANCELED
    // would hand a tenant the product on the strength of a failed payment.
    expect(toMirror(subscription({ status: 'incomplete' })).status).toBe('CANCELED')
    expect(toMirror(subscription({ status: 'incomplete_expired' })).status).toBe('CANCELED')
  })

  it('fails open on a status Stripe invents after we ship', () => {
    // PAST_DUE keeps the dealership working through fourteen days of grace,
    // which is long enough for a human to notice. CANCELED would not.
    expect(toMirror(subscription({ status: 'something_new' })).status).toBe('PAST_DUE')
  })

  it('defaults a missing quantity to one rather than zero', () => {
    // Zero would make the reconciler report drift against every real rooftop
    // the group has — noise on the screen that exists to show real problems.
    const mirror = toMirror(subscription({ items: { data: [{}] } }))
    expect(mirror.rooftopQuantity).toBe(1)
  })

  it('survives a subscription with no items at all', () => {
    expect(() => toMirror(subscription({ items: undefined }))).not.toThrow()
    expect(toMirror(subscription({ items: undefined })).currentPeriodEnd).toBeNull()
  })

  it('carries the cancelling flag without changing the status', () => {
    // Cancel-at-period-end is still ACTIVE. They paid for the period and keep
    // working to the end of it.
    const mirror = toMirror(subscription({ cancel_at_period_end: true }))
    expect(mirror.status).toBe('ACTIVE')
    expect(mirror.cancelAtPeriodEnd).toBe(true)
  })

  it('reads the trial deadline when there is one', () => {
    expect(toMirror(subscription({ trial_end: 1_700_000_000 })).trialEndsAt)
      .toEqual(new Date(1_700_000_000 * 1000))
    expect(toMirror(subscription({ trial_end: null })).trialEndsAt).toBeNull()
  })
})

describe('what a subscription means for the lifecycle', () => {
  it('activates on active, fails on past due, cancels on cancelled', () => {
    expect(lifecycleEventFor(toMirror(subscription({ status: 'active' }))))
      .toBe('SUBSCRIPTION_ACTIVATED')
    expect(lifecycleEventFor(toMirror(subscription({ status: 'past_due' }))))
      .toBe('PAYMENT_FAILED')
    expect(lifecycleEventFor(toMirror(subscription({ status: 'canceled' }))))
      .toBe('SUBSCRIPTION_CANCELED')
  })

  it('does nothing for a subscription still in its trial', () => {
    /*
      The important null. A trialing subscription must not mark a tenant
      ACTIVE — they are already TRIAL from provisioning, and moving them on a
      trial start would claim a payment succeeded when none has been attempted.
    */
    expect(lifecycleEventFor(toMirror(subscription({ status: 'trialing' })))).toBeNull()
  })
})

describe('event routing', () => {
  it('handles exactly the subscription lifecycle events and no others', () => {
    expect(isHandled('invoice.paid')).toBe(true)
    expect(isHandled('customer.subscription.updated')).toBe(true)
    expect(isHandled('checkout.session.completed')).toBe(true)
    expect(isHandled('charge.refunded')).toBe(false)
    expect(isHandled('payment_intent.succeeded')).toBe(false)
  })

  it('finds the subscription id on a subscription event', () => {
    expect(subscriptionIdFrom('customer.subscription.updated', { id: 'sub_1' })).toBe('sub_1')
  })

  it('finds it on a checkout session, expanded or not', () => {
    expect(subscriptionIdFrom('checkout.session.completed', { subscription: 'sub_2' })).toBe('sub_2')
    expect(subscriptionIdFrom('checkout.session.completed', { subscription: { id: 'sub_3' } }))
      .toBe('sub_3')
  })

  it('finds it on an invoice, in either payload shape', () => {
    // Older shape, and anything replayed out of the stored ledger.
    expect(subscriptionIdFrom('invoice.paid', { subscription: 'sub_4' })).toBe('sub_4')

    // Current shape: hung off a line item's parent, three levels down.
    const modern = {
      lines: {
        data: [{
          parent: { subscription_item_details: { subscription: 'sub_5' } },
        }],
      },
    }
    expect(subscriptionIdFrom('invoice.paid', modern)).toBe('sub_5')
  })

  it('returns null for an invoice that is not about a subscription', () => {
    // Normal, not an error — a one-off invoice has no subscription.
    expect(subscriptionIdFrom('invoice.paid', { lines: { data: [] } })).toBeNull()
    expect(subscriptionIdFrom('invoice.paid', {})).toBeNull()
  })

  it('never throws on a malformed payload', () => {
    // This runs against whatever arrives over the wire. A crash here is a 500
    // to Stripe and an event retried forever.
    expect(() => subscriptionIdFrom('invoice.paid', null)).not.toThrow()
    expect(() => subscriptionIdFrom('invoice.paid', { lines: { data: [null] } })).not.toThrow()
    expect(() => subscriptionIdFrom('unknown.event', { id: 'x' })).not.toThrow()
    expect(subscriptionIdFrom('unknown.event', { id: 'x' })).toBeNull()
  })
})
