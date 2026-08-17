import { differenceInCalendarDays } from 'date-fns'

/**
 * Where a tenant stands commercially, and how it is allowed to move.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A TABLE AND NOT A PILE OF IF STATEMENTS
 * ---------------------------------------------------------------------------
 * Lifecycle bugs are not loud. A tenant that ends up SUSPENDED because two
 * code paths disagreed about what a failed invoice means does not throw an
 * error — it just quietly stops working for a dealership that paid. So every
 * legal move is enumerated in one place, everything else is refused, and the
 * only way to change a status anywhere in this application is to come through
 * `transition` and have it agree.
 *
 * Pure and I/O-free, like the coverage engine. The database write that follows
 * a decision lives in the caller; this only decides.
 *
 * See docs/SAAS_PLAN.md §4.1 for the reasoning behind the shape of the table.
 */

export type LifecycleStatus =
  | 'TRIAL'
  | 'EXPIRED'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'RESTRICTED'
  | 'SUSPENDED'
  | 'CANCELED'
  | 'CHURNED'
  | 'COMPED'

export type LifecycleActor = 'SYSTEM' | 'WEBHOOK' | 'RECONCILER' | 'PLATFORM_ADMIN'

/**
 * The things that can happen to a tenant.
 *
 * Named after the event, not the destination — `PAYMENT_FAILED`, not
 * `GO_PAST_DUE`. What a failed payment *means* is this table's business, and
 * naming events after their outcome is how a caller ends up deciding policy by
 * choosing which one to fire.
 */
export type LifecycleEvent =
  | 'SUBSCRIPTION_ACTIVATED'
  | 'TRIAL_EXPIRED'
  | 'TRIAL_EXTENDED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_RECOVERED'
  | 'DUNNING_EXHAUSTED'
  | 'SUSPENDED_BY_ADMIN'
  | 'REACTIVATED_BY_ADMIN'
  | 'SUBSCRIPTION_CANCELED'
  | 'COMP_ENDED'
  | 'CHURN_CONFIRMED'
  | 'COMPED_BY_ADMIN'
  | 'WIN_BACK'

/** How long a past-due tenant keeps everything before losing the extras. */
export const GRACE_DAYS = 14

/** How long a dead tenant sits in its final state before becoming history. */
export const CHURN_AFTER_DAYS = 30

interface Rule {
  from: LifecycleStatus[]
  to: LifecycleStatus
  /**
   * Who is permitted to fire it.
   *
   * The narrow one is SUSPENDED_BY_ADMIN. Suspension is the rung of the ladder
   * that stops a dealership working, and nothing automatic may reach it — not
   * a webhook, not the nightly job. A human decides, with a reason, and the
   * decision leaves a row. That is the whole point of the restriction and it
   * is enforced here rather than by convention at the call sites.
   */
  actors: LifecycleActor[]
}

const RULES: Record<LifecycleEvent, Rule> = {
  SUBSCRIPTION_ACTIVATED: {
    // From EXPIRED too: a trial that lapsed and converted three weeks later is
    // a won deal, not an edge case.
    from: ['TRIAL', 'EXPIRED', 'PAST_DUE', 'RESTRICTED', 'CANCELED'],
    to: 'ACTIVE',
    actors: ['WEBHOOK', 'RECONCILER', 'PLATFORM_ADMIN'],
  },
  TRIAL_EXPIRED: {
    from: ['TRIAL'],
    to: 'EXPIRED',
    actors: ['RECONCILER', 'SYSTEM'],
  },
  TRIAL_EXTENDED: {
    // Self-transition. The status does not change; `trial_ends_at` does, and
    // the event exists so the extension is recorded as a decision somebody
    // made rather than as a timestamp that silently moved.
    from: ['TRIAL', 'EXPIRED'],
    to: 'TRIAL',
    actors: ['PLATFORM_ADMIN'],
  },
  PAYMENT_FAILED: {
    from: ['ACTIVE'],
    to: 'PAST_DUE',
    actors: ['WEBHOOK', 'RECONCILER'],
  },
  PAYMENT_RECOVERED: {
    from: ['PAST_DUE', 'RESTRICTED', 'SUSPENDED'],
    to: 'ACTIVE',
    actors: ['WEBHOOK', 'RECONCILER'],
  },
  DUNNING_EXHAUSTED: {
    from: ['PAST_DUE'],
    to: 'RESTRICTED',
    actors: ['RECONCILER'],
  },
  SUSPENDED_BY_ADMIN: {
    /*
      RESTRICTED only, deliberately.

      Suspension cannot be reached from ACTIVE or PAST_DUE, which means a
      dealership always passes through fourteen days of grace and a period of
      visible restriction — with banners their managers have seen — before
      anybody can switch them off. Making that a precondition of the state
      machine rather than a habit means an angry Friday afternoon cannot
      shortcut it.
    */
    from: ['RESTRICTED'],
    to: 'SUSPENDED',
    actors: ['PLATFORM_ADMIN'],
  },
  REACTIVATED_BY_ADMIN: {
    from: ['SUSPENDED', 'RESTRICTED', 'EXPIRED'],
    to: 'ACTIVE',
    actors: ['PLATFORM_ADMIN'],
  },
  SUBSCRIPTION_CANCELED: {
    from: ['ACTIVE', 'PAST_DUE', 'RESTRICTED', 'COMPED'],
    to: 'CANCELED',
    /*
      No PLATFORM_ADMIN, deliberately, and it is a narrowing rather than an
      oversight.

      This event means "Stripe has stopped billing them", which only Stripe can
      report. A console path firing it would mark a dealership CANCELED while
      their subscription carried on invoicing — our records saying the
      relationship is over while their card is still charged monthly, with
      nothing anywhere to notice the disagreement.

      The console ends a subscription by scheduling it with Stripe
      (`scheduleCancellation`) and letting the webhook fire this when it
      actually happens. The one commercial ending that has no Stripe
      counterpart is a comp, and that has its own event below.
    */
    actors: ['WEBHOOK', 'RECONCILER'],
  },
  COMP_ENDED: {
    /*
      Ending a free arrangement, which is the one cancellation with nothing in
      Stripe behind it.

      Separate from SUBSCRIPTION_CANCELED because the two are different facts
      that happen to share a destination: one is Stripe reporting that billing
      stopped, this is a person deciding a comp is over. Collapsing them would
      have meant giving the console authority over the first, which is exactly
      what the note above refuses.

      Lands in CANCELED rather than straight in CHURNED so the ordinary thirty
      days of grace apply. A dealership on a comp is still a dealership with
      customers booked in tomorrow, and ending the arrangement is a commercial
      decision, not a reason to close their account this afternoon.
    */
    from: ['COMPED'],
    to: 'CANCELED',
    actors: ['PLATFORM_ADMIN'],
  },
  CHURN_CONFIRMED: {
    from: ['CANCELED', 'SUSPENDED', 'EXPIRED'],
    to: 'CHURNED',
    actors: ['RECONCILER', 'PLATFORM_ADMIN'],
  },
  COMPED_BY_ADMIN: {
    // From any live state. Not from CHURNED — winning somebody back is
    // WIN_BACK, which is a different conversation and a different record.
    from: ['TRIAL', 'EXPIRED', 'ACTIVE', 'PAST_DUE', 'RESTRICTED', 'SUSPENDED', 'CANCELED'],
    to: 'COMPED',
    actors: ['PLATFORM_ADMIN'],
  },
  WIN_BACK: {
    from: ['CHURNED'],
    to: 'TRIAL',
    actors: ['PLATFORM_ADMIN'],
  },
}

export interface TransitionOk {
  ok: true
  from: LifecycleStatus
  to: LifecycleStatus
  event: LifecycleEvent
  actor: LifecycleActor
  /** True when the status did not move — a trial extension, say. */
  isSelfTransition: boolean
}

export interface TransitionRefused {
  ok: false
  /** Plain enough to put in front of a human, because it ends up on screen. */
  reason: string
}

export type TransitionResult = TransitionOk | TransitionRefused

/**
 * May this tenant make this move, and where does it land?
 *
 * Refuses rather than throws. An illegal transition is usually a race — two
 * webhooks arriving out of order, a nightly job running while somebody clicks
 * — and the right response to "this tenant is already ACTIVE" is to do
 * nothing, not to return a 500 to Stripe and have it retry forever.
 */
export function transition(
  from: LifecycleStatus,
  event: LifecycleEvent,
  actor: LifecycleActor,
): TransitionResult {
  const rule = RULES[event]
  if (!rule) return { ok: false, reason: `Unknown lifecycle event "${event}".` }

  if (!rule.actors.includes(actor)) {
    return {
      ok: false,
      reason: `${actor} may not perform ${event}${
        event === 'SUSPENDED_BY_ADMIN'
          ? ' — suspending a dealership is a decision a person makes, never a job.'
          : '.'
      }`,
    }
  }

  if (!rule.from.includes(from)) {
    return {
      ok: false,
      reason: `A ${from} tenant cannot ${event}${
        event === 'SUSPENDED_BY_ADMIN'
          ? ' — suspension is only reachable from RESTRICTED, so nobody skips the grace period.'
          : ` (allowed from: ${rule.from.join(', ')})`
      }.`,
    }
  }

  return {
    ok: true,
    from,
    to: rule.to,
    event,
    actor,
    isSelfTransition: from === rule.to,
  }
}

/**
 * What the nightly job should do about this tenant, if anything.
 *
 * The clocks live here rather than in the reconciler so they can be tested
 * against a fixed date instead of against whatever today happens to be. Order
 * matters: churn is checked before the grace ladder, because a CANCELED tenant
 * is not past due, it is finished.
 */
export function dueTransition(
  status: LifecycleStatus,
  statusChangedAt: Date,
  trialEndsAt: Date | null,
  asOf: Date,
): LifecycleEvent | null {
  const daysInStatus = differenceInCalendarDays(asOf, statusChangedAt)

  if (
    (status === 'CANCELED' || status === 'SUSPENDED' || status === 'EXPIRED') &&
    daysInStatus >= CHURN_AFTER_DAYS
  ) {
    return 'CHURN_CONFIRMED'
  }

  if (status === 'PAST_DUE' && daysInStatus >= GRACE_DAYS) return 'DUNNING_EXHAUSTED'

  /*
    A trial with no deadline never expires.

    That is not a hole — it is how a comped-in-all-but-name pilot is
    represented before somebody converts it properly, and the console shows the
    missing date. Guessing thirty days from the status change would expire
    accounts nobody set a clock on.
  */
  if (status === 'TRIAL' && trialEndsAt && asOf >= trialEndsAt) return 'TRIAL_EXPIRED'

  return null
}
