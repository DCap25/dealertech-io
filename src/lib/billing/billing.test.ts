import { describe, expect, it } from 'vitest'
import {
  CHURN_AFTER_DAYS, GRACE_DAYS, dueTransition, transition,
  type LifecycleActor, type LifecycleEvent, type LifecycleStatus,
} from './lifecycle'
import { permits, resolveAccess, type GuardedAction } from './access'

/**
 * The lifecycle and access engines.
 *
 * These decide whether a dealership can work, so the tests are written to be
 * hostile: every illegal transition enumerated, every boundary day checked on
 * both sides, and an explicit assertion that no automatic path can reach the
 * two states that stop the drive.
 */

const DAY = 86_400_000
const NOW = new Date('2026-03-15T09:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY)
const daysAhead = (n: number) => new Date(NOW.getTime() + n * DAY)

const ALL_STATUSES: LifecycleStatus[] = [
  'TRIAL', 'EXPIRED', 'ACTIVE', 'PAST_DUE', 'RESTRICTED',
  'SUSPENDED', 'CANCELED', 'CHURNED', 'COMPED',
]

const ALL_EVENTS: LifecycleEvent[] = [
  'SUBSCRIPTION_ACTIVATED', 'TRIAL_EXPIRED', 'TRIAL_EXTENDED', 'PAYMENT_FAILED',
  'PAYMENT_RECOVERED', 'DUNNING_EXHAUSTED', 'SUSPENDED_BY_ADMIN', 'REACTIVATED_BY_ADMIN',
  'SUBSCRIPTION_CANCELED', 'COMP_ENDED', 'CHURN_CONFIRMED', 'COMPED_BY_ADMIN', 'WIN_BACK',
]

const AUTOMATIC: LifecycleActor[] = ['SYSTEM', 'WEBHOOK', 'RECONCILER']

// ===========================================================================

describe('lifecycle transitions', () => {
  it('takes a trial to active when the subscription starts', () => {
    const result = transition('TRIAL', 'SUBSCRIPTION_ACTIVATED', 'WEBHOOK')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.to).toBe('ACTIVE')
      expect(result.isSelfTransition).toBe(false)
    }
  })

  it('converts a trial that already lapsed', () => {
    // A deal closed three weeks after the trial ran out is a won deal.
    const result = transition('EXPIRED', 'SUBSCRIPTION_ACTIVATED', 'WEBHOOK')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.to).toBe('ACTIVE')
  })

  it('recovers a past-due tenant the moment the payment lands', () => {
    for (const from of ['PAST_DUE', 'RESTRICTED', 'SUSPENDED'] as LifecycleStatus[]) {
      const result = transition(from, 'PAYMENT_RECOVERED', 'WEBHOOK')
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.to).toBe('ACTIVE')
    }
  })

  it('records a trial extension as a decision, not a silent date change', () => {
    const result = transition('TRIAL', 'TRIAL_EXTENDED', 'PLATFORM_ADMIN')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.to).toBe('TRIAL')
      expect(result.isSelfTransition).toBe(true)
    }
  })

  it('refuses an event from a state it does not apply to', () => {
    const result = transition('CHURNED', 'PAYMENT_FAILED', 'WEBHOOK')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('CHURNED')
  })

  it('refuses rather than throws, so an out-of-order webhook is a no-op', () => {
    // Two deliveries arriving backwards must not 500 and be retried forever.
    expect(() => transition('ACTIVE', 'SUBSCRIPTION_ACTIVATED', 'WEBHOOK')).not.toThrow()
    expect(transition('ACTIVE', 'SUBSCRIPTION_ACTIVATED', 'WEBHOOK').ok).toBe(false)
  })

  it('never lets an unknown pairing through', () => {
    // Exhaustive sweep: every state × every event either lands somewhere legal
    // or is refused with a reason. Nothing returns ok with a bogus destination.
    for (const from of ALL_STATUSES) {
      for (const event of ALL_EVENTS) {
        for (const actor of [...AUTOMATIC, 'PLATFORM_ADMIN'] as LifecycleActor[]) {
          const result = transition(from, event, actor)
          if (result.ok) {
            expect(ALL_STATUSES).toContain(result.to)
          } else {
            expect(result.reason.length).toBeGreaterThan(0)
          }
        }
      }
    }
  })
})

describe('ending a comp, and who may say a subscription is over', () => {
  it('lets a platform admin end a comp, landing in CANCELED rather than CHURNED', () => {
    const result = transition('COMPED', 'COMP_ENDED', 'PLATFORM_ADMIN')
    expect(result.ok).toBe(true)
    // Thirty days of grace, like any other ending. A comped dealership still
    // has customers booked in tomorrow.
    if (result.ok) expect(result.to).toBe('CANCELED')
  })

  it('applies only to a comp', () => {
    for (const from of ALL_STATUSES.filter((s) => s !== 'COMPED')) {
      expect(transition(from, 'COMP_ENDED', 'PLATFORM_ADMIN').ok).toBe(false)
    }
  })

  it('is not something a job can decide', () => {
    for (const actor of AUTOMATIC) {
      expect(transition('COMPED', 'COMP_ENDED', actor).ok).toBe(false)
    }
  })

  it('refuses a platform admin who tries to declare a subscription cancelled', () => {
    /*
      The narrowing that COMP_ENDED exists to make possible, asserted from
      every state a paying tenant can be in.

      SUBSCRIPTION_CANCELED means "Stripe has stopped billing them", which only
      Stripe can report. A console path firing it would mark a dealership
      CANCELED while their card carried on being charged every month, with our
      records and Stripe disagreeing and nothing anywhere to notice.

      The console ends a real subscription by scheduling it with Stripe and
      letting the webhook fire this when it actually happens.
    */
    for (const from of ALL_STATUSES) {
      expect(transition(from, 'SUBSCRIPTION_CANCELED', 'PLATFORM_ADMIN').ok).toBe(false)
    }
    expect(transition('ACTIVE', 'SUBSCRIPTION_CANCELED', 'WEBHOOK').ok).toBe(true)
  })
})

describe('suspension is a human decision', () => {
  it('cannot be reached by any automatic actor', () => {
    for (const actor of AUTOMATIC) {
      const result = transition('RESTRICTED', 'SUSPENDED_BY_ADMIN', actor)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain('never a job')
    }
  })

  it('cannot skip the grace period', () => {
    // Only RESTRICTED may suspend, so a dealership always passes through
    // fourteen days of grace and visible restriction first.
    for (const from of ALL_STATUSES.filter((s) => s !== 'RESTRICTED')) {
      expect(transition(from, 'SUSPENDED_BY_ADMIN', 'PLATFORM_ADMIN').ok).toBe(false)
    }
    expect(transition('RESTRICTED', 'SUSPENDED_BY_ADMIN', 'PLATFORM_ADMIN').ok).toBe(true)
  })

  it('is the only way a paying dealership stops being able to work', () => {
    /*
      The load-bearing assertion of the whole design.

      Sweep every automatic transition and prove that none of them takes a
      tenant who is paying — or who is merely behind and could recover — to a
      state where the drive stops. Only a human can do that.

      Two automatic paths do end in a halt and both are legitimate:
      TRIAL → EXPIRED, which is a trial that was never paid for, and
      CANCELED → CHURNED, which fires thirty days after somebody asked to
      leave and their paid period ended. Neither is a paying dealership losing
      their morning, which is the thing this rule protects.
    */
    const PAYING: LifecycleStatus[] = ['ACTIVE', 'COMPED', 'PAST_DUE', 'RESTRICTED']

    for (const from of PAYING) {
      for (const event of ALL_EVENTS) {
        for (const actor of AUTOMATIC) {
          const result = transition(from, event, actor)
          if (!result.ok) continue
          const access = resolveAccess({
            status: result.to, statusChangedAt: NOW, trialEndsAt: null, asOf: NOW,
          })
          expect(
            access.canWork,
            `${actor} fired ${event} on a ${from} tenant and landed in ${result.to}, which stops the drive`,
          ).toBe(true)
        }
      }
    }
  })

  it('only ever halts a tenant who never paid or already left', () => {
    // The complement of the rule above: enumerate every automatic route to a
    // halt, so adding a new one has to be a deliberate edit to this list.
    const halts: string[] = []
    for (const from of ALL_STATUSES) {
      for (const event of ALL_EVENTS) {
        for (const actor of AUTOMATIC) {
          const result = transition(from, event, actor)
          if (!result.ok) continue
          const access = resolveAccess({
            status: result.to, statusChangedAt: NOW, trialEndsAt: null, asOf: NOW,
          })
          if (!access.canWork) halts.push(`${from}->${result.to}`)
        }
      }
    }
    expect([...new Set(halts)].sort()).toEqual([
      'CANCELED->CHURNED', 'EXPIRED->CHURNED', 'SUSPENDED->CHURNED', 'TRIAL->EXPIRED',
    ])
  })
})

describe('the clocks', () => {
  it('restricts a past-due tenant on day fourteen and not day thirteen', () => {
    expect(dueTransition('PAST_DUE', daysAgo(GRACE_DAYS - 1), null, NOW)).toBeNull()
    expect(dueTransition('PAST_DUE', daysAgo(GRACE_DAYS), null, NOW)).toBe('DUNNING_EXHAUSTED')
  })

  it('churns a dead tenant on day thirty and not day twenty-nine', () => {
    for (const status of ['CANCELED', 'SUSPENDED', 'EXPIRED'] as LifecycleStatus[]) {
      expect(dueTransition(status, daysAgo(CHURN_AFTER_DAYS - 1), null, NOW)).toBeNull()
      expect(dueTransition(status, daysAgo(CHURN_AFTER_DAYS), null, NOW)).toBe('CHURN_CONFIRMED')
    }
  })

  it('expires a trial when its own deadline passes, not on a guessed one', () => {
    expect(dueTransition('TRIAL', daysAgo(90), daysAhead(1), NOW)).toBeNull()
    expect(dueTransition('TRIAL', daysAgo(90), daysAgo(1), NOW)).toBe('TRIAL_EXPIRED')
  })

  it('never expires a trial that has no deadline', () => {
    // An open-ended pilot is a real arrangement. Guessing thirty days would
    // switch off an account nobody put a clock on.
    expect(dueTransition('TRIAL', daysAgo(400), null, NOW)).toBeNull()
  })

  it('leaves a healthy tenant alone', () => {
    expect(dueTransition('ACTIVE', daysAgo(400), null, NOW)).toBeNull()
    expect(dueTransition('COMPED', daysAgo(400), null, NOW)).toBeNull()
  })

  it('treats a churned tenant as finished rather than as still past due', () => {
    expect(dueTransition('CHURNED', daysAgo(400), null, NOW)).toBeNull()
  })
})

// ===========================================================================

describe('access: the drive always works', () => {
  const DRIVE_SURVIVES: LifecycleStatus[] = [
    'ACTIVE', 'COMPED', 'TRIAL', 'PAST_DUE', 'RESTRICTED', 'CANCELED',
  ]

  it('keeps a dealership working through every state a job can cause', () => {
    for (const status of DRIVE_SURVIVES) {
      const decision = resolveAccess({
        status, statusChangedAt: daysAgo(20), trialEndsAt: daysAhead(10), asOf: NOW,
      })
      expect(decision.canWork).toBe(true)
    }
  })

  it('never blocks the drive at any level short of suspension', () => {
    // The blocked list is administrative surface only — there is no
    // PRESENT_MENU or VIEW_PREP_SHEET in GuardedAction, and that is the point.
    const administrative: GuardedAction[] = [
      'INVITE_STAFF', 'MANAGE_STAFF', 'EXPORT_DATA', 'MANAGE_INTEGRATIONS', 'ADD_STORE',
    ]
    for (const status of ALL_STATUSES) {
      const decision = resolveAccess({
        status, statusChangedAt: daysAgo(20), trialEndsAt: null, asOf: NOW,
      })
      for (const blocked of decision.blockedActions) {
        expect(administrative).toContain(blocked)
      }
    }
  })
})

describe('access: the ladder', () => {
  it('gives an active tenant everything and says nothing', () => {
    const decision = resolveAccess({
      status: 'ACTIVE', statusChangedAt: daysAgo(200), asOf: NOW,
    })
    expect(decision.level).toBe('FULL')
    expect(decision.banner).toBeNull()
    expect(decision.blockedActions).toHaveLength(0)
  })

  it('treats a comped tenant exactly as an active one', () => {
    const comped = resolveAccess({ status: 'COMPED', statusChangedAt: daysAgo(200), asOf: NOW })
    const active = resolveAccess({ status: 'ACTIVE', statusChangedAt: daysAgo(200), asOf: NOW })
    expect(comped).toEqual(active)
  })

  it('tells only managers about a failed payment', () => {
    const decision = resolveAccess({
      status: 'PAST_DUE', statusChangedAt: daysAgo(2), asOf: NOW,
    })
    expect(decision.level).toBe('GRACE')
    expect(decision.banner?.audience).toBe('MANAGERS')
    expect(decision.blockedActions).toHaveLength(0)
  })

  it('counts the grace period down in the banner', () => {
    const early = resolveAccess({ status: 'PAST_DUE', statusChangedAt: daysAgo(1), asOf: NOW })
    const late = resolveAccess({ status: 'PAST_DUE', statusChangedAt: daysAgo(12), asOf: NOW })
    expect(early.banner?.message).toContain('13 more days')
    expect(late.banner?.message).toContain('2 more days')
    expect(late.banner?.tone).toBe('WARNING')
  })

  it('takes the administrative surface at RESTRICTED and leaves the drive', () => {
    const decision = resolveAccess({
      status: 'RESTRICTED', statusChangedAt: daysAgo(1), asOf: NOW,
    })
    expect(decision.canWork).toBe(true)
    expect(permits(decision, 'INVITE_STAFF')).toBe(false)
    expect(permits(decision, 'ADD_STORE')).toBe(false)
    expect(decision.banner?.tone).toBe('CRITICAL')
    expect(decision.banner?.message).toContain('unaffected')
  })

  it('stops work only at SUSPENDED, and tells everyone why', () => {
    const decision = resolveAccess({
      status: 'SUSPENDED', statusChangedAt: daysAgo(1), asOf: NOW,
    })
    expect(decision.canWork).toBe(false)
    expect(decision.banner?.audience).toBe('EVERYONE')
  })

  it('lets a cancelled tenant work out the period they paid for', () => {
    const decision = resolveAccess({
      status: 'CANCELED', statusChangedAt: daysAgo(3), asOf: NOW,
    })
    expect(decision.canWork).toBe(true)
    expect(permits(decision, 'ADD_STORE')).toBe(false)
  })

  it('lets a churned dealership take their own data with them', () => {
    const decision = resolveAccess({
      status: 'CHURNED', statusChangedAt: daysAgo(60), asOf: NOW,
    })
    expect(decision.canWork).toBe(false)
    expect(permits(decision, 'EXPORT_DATA')).toBe(true)
    expect(permits(decision, 'INVITE_STAFF')).toBe(false)
  })

  it('warns a trial near its end without taking anything away', () => {
    const decision = resolveAccess({
      status: 'TRIAL', statusChangedAt: daysAgo(25), trialEndsAt: daysAhead(2), asOf: NOW,
    })
    expect(decision.level).toBe('FULL')
    expect(decision.blockedActions).toHaveLength(0)
    expect(decision.banner?.message).toContain('2 days')
  })

  it('says nothing to a trial with weeks left', () => {
    const decision = resolveAccess({
      status: 'TRIAL', statusChangedAt: daysAgo(2), trialEndsAt: daysAhead(28), asOf: NOW,
    })
    expect(decision.banner).toBeNull()
  })
})

describe('access: failing open', () => {
  it('grants full access when the status is missing, and says so loudly', () => {
    const decision = resolveAccess({ status: null, statusChangedAt: null, asOf: NOW })
    expect(decision.level).toBe('FULL')
    expect(decision.canWork).toBe(true)
    expect(decision.needsAttention).toBeTruthy()
  })

  it('grants full access for a status the engine does not recognise', () => {
    // The day somebody adds an enum value and forgets this file, a dealership
    // must not lose their morning to it.
    const decision = resolveAccess({
      status: 'SOMETHING_NEW' as LifecycleStatus, statusChangedAt: NOW, asOf: NOW,
    })
    expect(decision.canWork).toBe(true)
    expect(decision.needsAttention).toContain('SOMETHING_NEW')
  })

  it('never throws, whatever it is handed', () => {
    expect(() => resolveAccess({
      status: undefined, statusChangedAt: undefined, asOf: NOW,
    })).not.toThrow()
  })

  it('keeps a missing timestamp from producing a negative countdown', () => {
    const decision = resolveAccess({
      status: 'PAST_DUE', statusChangedAt: null, asOf: NOW,
    })
    expect(decision.banner?.message).toContain(`${GRACE_DAYS} more days`)
  })
})
