import { describe, expect, it } from 'vitest'
import {
  planCancellation, planReversal, type CancellationSubject,
} from './cancellation'
import { dueTransition } from './lifecycle'

/**
 * Scheduling the end of a subscription.
 *
 * The tests worth having here are the ones about *not acting yet*. Every
 * refusal below exists because the alternative was a dealership losing the
 * product during a period they had already paid for, or a support call being
 * told a date nobody could stand behind.
 */

const PERIOD_END = new Date('2026-10-01T00:00:00.000Z')

function subject(over: Partial<CancellationSubject> = {}): CancellationSubject {
  return {
    stripeSubscriptionId: 'sub_1',
    status: 'ACTIVE',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: PERIOD_END,
    ...over,
  }
}

describe('scheduling a cancellation', () => {
  it('allows an active subscription and reports the day access ends', () => {
    const plan = planCancellation(subject())
    expect(plan.ok).toBe(true)
    expect(plan.ok && plan.effectiveAt).toEqual(PERIOD_END)
  })

  it('allows a past-due dealership to leave', () => {
    // Refusing them because an invoice is outstanding leaves somebody
    // cancelling by hand in the Stripe dashboard, which is the thing this
    // replaces.
    expect(planCancellation(subject({ status: 'PAST_DUE' })).ok).toBe(true)
  })

  it('allows a trial that is not going to convert', () => {
    expect(planCancellation(subject({ status: 'TRIALING' })).ok).toBe(true)
  })

  it('reports no date rather than inventing one', () => {
    const plan = planCancellation(subject({ currentPeriodEnd: null }))
    expect(plan.ok).toBe(true)
    expect(plan.ok && plan.effectiveAt).toBeNull()
  })

  it('refuses a second cancellation and says when the first one lands', () => {
    const plan = planCancellation(subject({ cancelAtPeriodEnd: true }))
    expect(plan.ok).toBe(false)
    expect(plan.ok === false && plan.reason).toContain('2026-10-01')
  })

  it('refuses a subscription that has already ended', () => {
    expect(planCancellation(subject({ status: 'CANCELED' })).ok).toBe(false)
  })

  it('refuses a comp, and points at the lifecycle instead of just saying no', () => {
    const plan = planCancellation(subject({ status: 'COMPED', stripeSubscriptionId: null }))
    expect(plan.ok).toBe(false)
    expect(plan.ok === false && plan.reason).toContain('lifecycle')
  })

  it('refuses when the mirror has no Stripe id, whatever the status claims', () => {
    // A mirror row with an ACTIVE status and no subscription id is malformed.
    // Attempting the Stripe call would throw on a null id; refusing says why.
    expect(planCancellation(subject({ stripeSubscriptionId: null })).ok).toBe(false)
  })
})

describe('reversing one', () => {
  it('allows a scheduled cancellation to be called off', () => {
    expect(planReversal(subject({ cancelAtPeriodEnd: true })).ok).toBe(true)
  })

  it('refuses when nothing is scheduled', () => {
    expect(planReversal(subject()).ok).toBe(false)
  })

  it('refuses an ended subscription and says what winning them back takes', () => {
    const plan = planReversal(subject({ status: 'CANCELED', cancelAtPeriodEnd: true }))
    expect(plan.ok).toBe(false)
    expect(plan.ok === false && plan.reason).toContain('new one')
  })

  it('refuses a comp', () => {
    expect(planReversal(subject({ status: 'COMPED', stripeSubscriptionId: null })).ok).toBe(false)
  })
})

describe('the reason scheduling moves no lifecycle status', () => {
  /*
    This is the bug the whole module is shaped around, so it is asserted
    against the real clock rather than described in a comment.

    If scheduling a cancellation moved a tenant to CANCELED, the churn clock
    would start immediately — and a group who cancels well before renewal would
    be churned while they were still paying.
  */
  it('would churn a still-paying tenant thirty days after the click', () => {
    const clicked = new Date('2026-08-17T00:00:00.000Z')
    const thirtyDaysLater = new Date('2026-09-16T00:00:00.000Z')

    // Had we marked them CANCELED at the moment of scheduling:
    expect(dueTransition('CANCELED', clicked, null, thirtyDaysLater)).toBe('CHURN_CONFIRMED')

    // ...six weeks before the period they had already bought ran out.
    expect(thirtyDaysLater < PERIOD_END).toBe(true)

    // Leaving them ACTIVE, which is what this module does, is due nothing.
    expect(dueTransition('ACTIVE', clicked, null, thirtyDaysLater)).toBeNull()
  })
})
