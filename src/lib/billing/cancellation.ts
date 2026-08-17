/**
 * Deciding whether a subscription may be set to end, and when that lands.
 *
 * ---------------------------------------------------------------------------
 * WHY SCHEDULING A CANCELLATION MOVES NO LIFECYCLE STATUS
 * ---------------------------------------------------------------------------
 * The tempting shortcut is to fire `SUBSCRIPTION_CANCELED` the moment somebody
 * clicks cancel. It is wrong, and the clock in `dueTransition` is what makes it
 * wrong: a CANCELED tenant becomes CHURNED thirty days later. A dealer group
 * who cancels six weeks before their renewal would be churned while still
 * paying, and the first sign of it would be their advisors losing the product
 * a fortnight before the period they bought had run out.
 *
 * So scheduling records an intention and nothing else. The tenant stays ACTIVE,
 * keeps everything, and is billed exactly once more. When the period actually
 * ends, Stripe deletes the subscription, the webhook re-fetches it, sees
 * `canceled`, and fires `SUBSCRIPTION_CANCELED` then — which starts the thirty
 * days from the right moment. The path already exists and is already tested;
 * this only has to stay out of its way.
 *
 * ---------------------------------------------------------------------------
 * WHICH IS ALSO WHY REVERSAL IS CHEAP
 * ---------------------------------------------------------------------------
 * Nothing happened, so nothing has to be undone. A dealer group who cancels in
 * anger on Tuesday and is talked round on Thursday needs one flag flipped back,
 * not a new subscription, a new customer record and a gap in their history.
 * That is only true while we are careful not to act early, and it is the second
 * reason this module refuses to.
 *
 * Pure and I/O-free, like `reconcile.ts` next door. The Stripe call and the
 * mirror write live in `subscription-ops.ts`.
 */

/** The mirror's own vocabulary — Stripe's statuses plus COMPED, which it never sees. */
export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'COMPED'

/** What our tables hold about the subscription somebody wants to end. */
export interface CancellationSubject {
  stripeSubscriptionId: string | null
  status: SubscriptionStatus
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: Date | null
}

export type CancellationPlan =
  | {
      ok: true
      /**
       * The day access is actually lost, or null when Stripe has not told us.
       *
       * Null is rare and is not an error — a subscription mirrored before its
       * first invoice has no period end yet. The caller words the confirmation
       * differently rather than inventing a date, because the one number the
       * person on the phone wants is exactly this one and a guessed answer to
       * "so when does it stop?" is worse than "Stripe will confirm the date".
       */
      effectiveAt: Date | null
    }
  | { ok: false; reason: string }

/**
 * A comp has nothing in Stripe to schedule against.
 *
 * Shared by both directions because the refusal is the same fact, and because
 * the honest thing to say is not "no subscription" — it is what to do instead.
 * Ending a comped arrangement is a lifecycle decision, not a billing one.
 */
function refuseIfNothingToCancel(subject: CancellationSubject): CancellationPlan | null {
  if (subject.status === 'COMPED' || !subject.stripeSubscriptionId) {
    return {
      ok: false,
      reason:
        'This account is comped — there is no subscription in Stripe to schedule. '
        + 'Ending a comp is a lifecycle decision rather than a billing one.',
    }
  }
  return null
}

/** Formatted the way a date is read aloud on a support call, not as an ISO string. */
function on(date: Date | null): string {
  return date ? `on ${date.toISOString().slice(0, 10)}` : 'at the end of the current period'
}

/**
 * May this subscription be set to end when the paid period does?
 */
export function planCancellation(subject: CancellationSubject): CancellationPlan {
  const nothing = refuseIfNothingToCancel(subject)
  if (nothing) return nothing

  if (subject.status === 'CANCELED') {
    return {
      ok: false,
      reason: 'This subscription has already ended. There is nothing left to schedule.',
    }
  }

  if (subject.cancelAtPeriodEnd) {
    /*
      Refused rather than treated as a no-op, deliberately.

      A second cancellation is almost always somebody who cannot see that the
      first one worked — the console did not show it, or a colleague did it an
      hour ago. Reporting success again would confirm a belief they should not
      hold, and it would put a second CANCEL_SCHEDULED row in the commercial
      history for one decision.
    */
    return {
      ok: false,
      reason: `Already set to end ${on(subject.currentPeriodEnd)}.`,
    }
  }

  /*
    PAST_DUE is allowed through.

    A dealership who stopped paying and then asks to leave is the ordinary way
    this ends, and refusing them because an invoice is outstanding would leave
    somebody cancelling by hand in the Stripe dashboard — which is the state
    this action exists to replace. Their access ladder keeps running underneath
    regardless; that is a separate mechanism and it is not this one's business.

    TRIALING too: a trial that will not convert should stop cleanly rather than
    bill once and then be refunded.
  */
  return { ok: true, effectiveAt: subject.currentPeriodEnd }
}

/**
 * May a scheduled cancellation be called off?
 */
export function planReversal(subject: CancellationSubject): CancellationPlan {
  const nothing = refuseIfNothingToCancel(subject)
  if (nothing) return nothing

  if (subject.status === 'CANCELED') {
    /*
      The one genuinely irreversible case, and the reason the wording is blunt.

      Once Stripe has actually cancelled a subscription it cannot be resumed —
      a returning customer needs a new one. Somebody reading "reverse" on a
      console button will assume otherwise, so the refusal says what it would
      take rather than only that it cannot be done.
    */
    return {
      ok: false,
      reason:
        'This subscription has already ended, and an ended subscription cannot be resumed. '
        + 'Winning them back means starting a new one.',
    }
  }

  if (!subject.cancelAtPeriodEnd) {
    return { ok: false, reason: 'This subscription is not scheduled to end.' }
  }

  return { ok: true, effectiveAt: subject.currentPeriodEnd }
}
