import type { SubscriptionMirror } from './stripe-map'

/**
 * Deciding what to do when Stripe and our tables disagree.
 *
 * ---------------------------------------------------------------------------
 * TWO KINDS OF DISAGREEMENT, AND ONLY ONE IS SAFE TO FIX
 * ---------------------------------------------------------------------------
 * A **mirror drift** is our copy of a Stripe fact going stale — a status, a
 * period end, a cancel flag. Stripe is definitionally right about those, so
 * the reconciler overwrites ours and says nothing. There is no judgement in it.
 *
 * A **quantity drift** is different. Stripe says we bill for eight rooftops
 * and the database has nine active stores. That is not a stale copy; it is a
 * commercial fact nobody has decided about. It could be a rooftop opened last
 * week that nobody added to the subscription, or one deactivated during a
 * dispute that is deliberately still being paid for. Silently "correcting" it
 * either undercharges a customer or bills them for something they closed —
 * and the second one arrives as an angry phone call.
 *
 * So quantity drift is reported and never auto-fixed. It goes on the console
 * for a human, which is the honest handling of a question we cannot answer.
 *
 * Pure and I/O-free. The runner does the fetching and writing.
 */

export type DiscrepancyKind =
  | 'STATUS_DRIFT'
  | 'PERIOD_DRIFT'
  | 'CANCEL_FLAG_DRIFT'
  | 'QUANTITY_DRIFT'
  | 'MISSING_IN_STRIPE'

export interface Discrepancy {
  kind: DiscrepancyKind
  /** Safe for the reconciler to apply without asking anybody. */
  autoFixable: boolean
  detail: string
}

/** What our tables currently believe. */
export interface LocalSubscription {
  stripeSubscriptionId: string | null
  status: string
  rooftopQuantity: number
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  // Stripe timestamps are whole seconds; a millisecond difference is a
  // round-trip artefact, not a drift worth reporting every single night.
  return Math.abs(a.getTime() - b.getTime()) < 1000
}

/**
 * Compare one subscription against Stripe.
 *
 * `remote` is null when Stripe has no such subscription. `activeStoreCount` is
 * what the database says the group actually runs.
 */
export function diff(
  local: LocalSubscription,
  remote: SubscriptionMirror | null,
  activeStoreCount: number,
): Discrepancy[] {
  const out: Discrepancy[] = []

  /*
    A comped account has no Stripe counterpart and never will.

    Checked before anything else, because every other rule below would fire on
    it — and reporting the same four discrepancies every night for an account
    we deliberately gave away is how a needs-attention list stops being read.
  */
  if (local.status === 'COMPED') return out

  if (!remote) {
    out.push({
      kind: 'MISSING_IN_STRIPE',
      autoFixable: false,
      detail: local.stripeSubscriptionId
        ? `Subscription ${local.stripeSubscriptionId} is in our tables but not in Stripe.`
        : 'Local subscription has no Stripe id at all.',
    })
    return out
  }

  if (local.status !== remote.status) {
    out.push({
      kind: 'STATUS_DRIFT',
      autoFixable: true,
      detail: `We say ${local.status}; Stripe says ${remote.status}.`,
    })
  }

  if (!sameInstant(local.currentPeriodEnd, remote.currentPeriodEnd)) {
    out.push({
      kind: 'PERIOD_DRIFT',
      autoFixable: true,
      detail: `Period end differs — ours ${local.currentPeriodEnd?.toISOString() ?? 'null'}, Stripe ${remote.currentPeriodEnd?.toISOString() ?? 'null'}.`,
    })
  }

  if (local.cancelAtPeriodEnd !== remote.cancelAtPeriodEnd) {
    out.push({
      kind: 'CANCEL_FLAG_DRIFT',
      autoFixable: true,
      detail: `Cancel-at-period-end differs — ours ${local.cancelAtPeriodEnd}, Stripe ${remote.cancelAtPeriodEnd}.`,
    })
  }

  /*
    The one a human has to look at.

    Compared against the *active store count*, not against our mirror — the
    mirror is a copy of Stripe and would always agree with it. The question is
    whether what we bill matches what the dealership runs, and only the
    database knows the second half of that.
  */
  if (remote.rooftopQuantity !== activeStoreCount) {
    out.push({
      kind: 'QUANTITY_DRIFT',
      autoFixable: false,
      detail:
        `Billing for ${remote.rooftopQuantity} rooftop${remote.rooftopQuantity === 1 ? '' : 's'}, ` +
        `${activeStoreCount} active. Someone has to decide which is right — a new rooftop nobody ` +
        `added to the subscription and one deactivated mid-dispute look identical from here.`,
    })
  }

  return out
}

/** Did anything come back that a person needs to see? */
export function needsHuman(discrepancies: Discrepancy[]): boolean {
  return discrepancies.some((d) => !d.autoFixable)
}
