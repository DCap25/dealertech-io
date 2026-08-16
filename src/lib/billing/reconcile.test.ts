import { describe, expect, it } from 'vitest'
import { diff, needsHuman, type LocalSubscription } from './reconcile'
import type { SubscriptionMirror } from './stripe-map'

/**
 * Reconciliation.
 *
 * The tests that matter here are the ones about what the job must NOT do on
 * its own. Auto-correcting a rooftop count either undercharges a customer or
 * bills them for a store they closed, and the second arrives as a phone call.
 */

const PERIOD_END = new Date('2026-04-01T00:00:00.000Z')

function local(over: Partial<LocalSubscription> = {}): LocalSubscription {
  return {
    stripeSubscriptionId: 'sub_1',
    status: 'ACTIVE',
    rooftopQuantity: 3,
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: false,
    ...over,
  }
}

function remote(over: Partial<SubscriptionMirror> = {}): SubscriptionMirror {
  return {
    stripeSubscriptionId: 'sub_1',
    status: 'ACTIVE',
    rooftopQuantity: 3,
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: false,
    trialEndsAt: null,
    ...over,
  }
}

describe('in step', () => {
  it('reports nothing when everything agrees', () => {
    expect(diff(local(), remote(), 3)).toEqual([])
  })

  it('ignores a sub-second difference in period end', () => {
    // Stripe timestamps are whole seconds; a millisecond of round-trip is not
    // a drift worth reporting every night for the life of the account.
    const slightly = new Date(PERIOD_END.getTime() + 400)
    expect(diff(local(), remote({ currentPeriodEnd: slightly }), 3)).toEqual([])
  })
})

describe('mirror drift — safe to fix', () => {
  it('flags a stale status as auto-fixable', () => {
    const [d] = diff(local({ status: 'ACTIVE' }), remote({ status: 'PAST_DUE' }), 3)
    expect(d!.kind).toBe('STATUS_DRIFT')
    expect(d!.autoFixable).toBe(true)
  })

  it('flags a stale period end and cancel flag', () => {
    const found = diff(
      local(),
      remote({ currentPeriodEnd: new Date('2026-05-01T00:00:00.000Z'), cancelAtPeriodEnd: true }),
      3,
    )
    expect(found.map((d) => d.kind).sort()).toEqual(['CANCEL_FLAG_DRIFT', 'PERIOD_DRIFT'])
    expect(found.every((d) => d.autoFixable)).toBe(true)
  })

  it('does not need a human for mirror drift alone', () => {
    expect(needsHuman(diff(local({ status: 'ACTIVE' }), remote({ status: 'PAST_DUE' }), 3)))
      .toBe(false)
  })
})

describe('quantity drift — never fixed automatically', () => {
  it('reports it, and refuses to call it auto-fixable', () => {
    const [d] = diff(local(), remote({ rooftopQuantity: 3 }), 5)
    expect(d!.kind).toBe('QUANTITY_DRIFT')
    expect(d!.autoFixable).toBe(false)
    expect(needsHuman([d!])).toBe(true)
  })

  it('fires in both directions', () => {
    // Billing for more than they run, and fewer. Both are somebody's decision.
    expect(diff(local(), remote({ rooftopQuantity: 8 }), 5)[0]!.kind).toBe('QUANTITY_DRIFT')
    expect(diff(local(), remote({ rooftopQuantity: 2 }), 5)[0]!.kind).toBe('QUANTITY_DRIFT')
  })

  it('compares Stripe against the real store count, not against our mirror', () => {
    /*
      The mirror is a copy of Stripe, so comparing them would always agree and
      the check would be worthless. The question is whether what we bill
      matches what the dealership actually runs.
    */
    const stale = local({ rooftopQuantity: 99 })
    expect(diff(stale, remote({ rooftopQuantity: 4 }), 4)).toEqual([])
  })

  it('explains why nobody can decide it from here', () => {
    const [d] = diff(local(), remote({ rooftopQuantity: 3 }), 4)
    expect(d!.detail).toContain('mid-dispute')
  })
})

describe('comped accounts', () => {
  it('are exempt from every check', () => {
    // No Stripe counterpart and never will have one. Reporting four
    // discrepancies nightly for an account we deliberately gave away is how a
    // needs-attention list stops being read.
    const comped = local({ status: 'COMPED', stripeSubscriptionId: null })
    expect(diff(comped, null, 12)).toEqual([])
  })
})

describe('missing in Stripe', () => {
  it('is reported and needs a human', () => {
    const [d] = diff(local(), null, 3)
    expect(d!.kind).toBe('MISSING_IN_STRIPE')
    expect(d!.autoFixable).toBe(false)
  })

  it('does not also report every other kind of drift', () => {
    // Once the subscription is gone, status and period comparisons are noise.
    expect(diff(local(), null, 99)).toHaveLength(1)
  })
})
