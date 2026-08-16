import { monthlyTotalCents, bandFor, type Band } from './plans'

/**
 * What changing the rooftop count does to the next invoice.
 *
 * ---------------------------------------------------------------------------
 * STRIPE IS AUTHORITATIVE. THIS IS FOR THE HUMAN ABOUT TO PRESS THE BUTTON.
 * ---------------------------------------------------------------------------
 * Stripe computes the real proration when it issues the invoice, to the second
 * and against its own record of the period. Nothing here overrides that, and
 * nothing here is used to charge anybody.
 *
 * It exists because a support engineer adding a rooftop for a dealer group
 * needs to be able to say what it will cost before they commit — and "Stripe
 * will work it out" is not an answer you can give a fixed ops director on the
 * phone. A figure that is right to the dollar for the ordinary cases is worth
 * far more than no figure at all.
 *
 * Where it could disagree with Stripe, it is built to disagree in the
 * direction of caution: the estimate rounds a charge up and a credit down, so
 * the number quoted is never a pleasant surprise that becomes an unpleasant
 * invoice.
 *
 * ---------------------------------------------------------------------------
 * THE CASE THAT SURPRISES PEOPLE
 * ---------------------------------------------------------------------------
 * Pricing is volume-tiered, so adding a rooftop re-prices the whole group. A
 * dealer going from 25 to 26 rooftops moves from $895 to $795 each — their
 * bill goes *down* by about $1,700 a month while adding a store. A console
 * that shows "+1 rooftop, +$795" there would be wrong by two and a half
 * thousand dollars and would look like a bug to the person reading it. The
 * band crossing is therefore called out explicitly rather than left implicit
 * in the arithmetic.
 *
 * Pure and I/O-free. Money in cents throughout.
 */

export interface ProrationInput {
  fromRooftops: number
  toRooftops: number
  /** The subscription period this change lands inside. */
  periodStart: Date
  periodEnd: Date
  asOf: Date
}

export interface ProrationPreview {
  fromRooftops: number
  toRooftops: number
  /** Steady-state, both sides. What the invoice looks like from next period on. */
  currentMonthlyCents: number
  newMonthlyCents: number
  monthlyDifferenceCents: number

  /** 0–1. How much of the period is still to run when the change lands. */
  remainingFraction: number
  /**
   * Charged now for the rest of this period, or credited if negative.
   *
   * An estimate — see the header. Rounded away from the customer's favour so
   * the quoted figure is never lower than the invoice.
   */
  immediateCents: number

  /** True when the group moves between volume bands. */
  bandChange: { from: Band; to: Band } | null
  /** Set when the bill falls despite rooftops being added, or vice versa. */
  counterIntuitive: string | null
}

/**
 * How much of the billing period is left.
 *
 * Clamped at both ends. A change dated before the period opened is the whole
 * period; one dated after it closed is none of it. Both are reachable from a
 * stale page or a mid-renewal race, and a fraction outside 0–1 would produce a
 * confidently wrong number rather than an obviously wrong one.
 */
export function remainingFraction(periodStart: Date, periodEnd: Date, asOf: Date): number {
  const total = periodEnd.getTime() - periodStart.getTime()
  if (total <= 0) return 0

  const left = periodEnd.getTime() - asOf.getTime()
  if (left <= 0) return 0
  if (left >= total) return 1
  return left / total
}

export function previewProration(input: ProrationInput): ProrationPreview {
  const from = Math.max(0, Math.floor(input.fromRooftops))
  const to = Math.max(0, Math.floor(input.toRooftops))

  const currentMonthlyCents = monthlyTotalCents(from)
  const newMonthlyCents = monthlyTotalCents(to)
  const monthlyDifferenceCents = newMonthlyCents - currentMonthlyCents

  const fraction = remainingFraction(input.periodStart, input.periodEnd, input.asOf)

  /*
    Rounded away from the customer's favour, and `ceil` does both jobs.

    On a charge it rounds up (12.3 → 13). On a credit it rounds toward zero
    (-12.7 → -12), which is a slightly smaller credit. Either way the figure a
    support engineer quotes is never better for the dealership than what
    Stripe eventually invoices — being a cent pessimistic is invisible, being
    a cent optimistic is a phone call about a bill that did not match what
    they were told.
  */
  const immediateCents = Math.ceil(monthlyDifferenceCents * fraction)

  const fromBand = bandFor(from)
  const toBand = bandFor(to)
  const bandChange = fromBand === toBand ? null : { from: fromBand, to: toBand }

  let counterIntuitive: string | null = null
  if (to > from && monthlyDifferenceCents < 0) {
    counterIntuitive =
      `Adding ${to - from} rooftop(s) moves this group into the ${toBand.label} band, so the monthly bill falls. This is correct — volume pricing re-prices every rooftop, not just the new ones.`
  } else if (to < from && monthlyDifferenceCents > 0) {
    counterIntuitive =
      `Removing ${from - to} rooftop(s) moves this group out of the ${fromBand.label} band, so the monthly bill rises. Worth saying out loud before they hear it from an invoice.`
  }

  return {
    fromRooftops: from,
    toRooftops: to,
    currentMonthlyCents,
    newMonthlyCents,
    monthlyDifferenceCents,
    remainingFraction: fraction,
    immediateCents,
    bandChange,
    counterIntuitive,
  }
}

/**
 * A sentence for the console.
 *
 * Written as one thing a person reads aloud on a phone call, because that is
 * literally what happens to it. Amounts in dollars; the caller does not think
 * in cents.
 */
export function describeProration(p: ProrationPreview): string {
  const money = (cents: number) =>
    Math.abs(cents / 100).toLocaleString('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 2,
    })

  const monthly = p.monthlyDifferenceCents === 0
    ? 'Their monthly bill does not change'
    : p.monthlyDifferenceCents > 0
      ? `Their monthly bill goes up by ${money(p.monthlyDifferenceCents)} to ${money(p.newMonthlyCents)}`
      : `Their monthly bill goes down by ${money(p.monthlyDifferenceCents)} to ${money(p.newMonthlyCents)}`

  if (p.immediateCents === 0) return `${monthly}, with nothing charged today.`

  const now = p.immediateCents > 0
    ? `about ${money(p.immediateCents)} is charged now for the rest of this period`
    : `about ${money(p.immediateCents)} is credited against their next invoice`

  return `${monthly}, and ${now}.`
}
