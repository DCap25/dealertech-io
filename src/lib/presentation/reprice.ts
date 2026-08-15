/**
 * When the price moves after the customer already said yes.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MATTERS MORE THAN IT LOOKS
 * ---------------------------------------------------------------------------
 * A customer authorised $84 at eleven o'clock. The part comes in at a different
 * number, or the morning price sync moved the op code, and by the time the work
 * is written up it is $95. Charging the $95 is how a dealership acquires a
 * furious customer, a chargeback, and — depending where it trades — a
 * regulator.
 *
 * California is the strictest well-known example: a shop may not charge more
 * than the estimate without the customer's consent, and has to be able to say
 * who gave it and when. Other states set their own thresholds. This does not
 * try to encode any of that, because the rule varies and getting it subtly
 * wrong in code is worse than not claiming to know it — the threshold is a
 * store setting, and the default is the conservative one: any real increase
 * needs asking again.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS DRIFT
 * ---------------------------------------------------------------------------
 * Increases only. Charging a customer LESS than they agreed to needs nobody's
 * permission, and a system that made an advisor chase a re-authorisation to
 * give somebody a discount would be one they route around within a week.
 *
 * A line that vanished is not drift either — it cannot be billed, so there is
 * nothing to re-authorise. A line that appeared was never authorised at all;
 * that is a new recommendation and a new conversation, not a repricing.
 *
 * Pure and I/O-free.
 */

export interface PricedLine {
  id: string
  title: string
  /** What the customer pays, after coverage. */
  customerPrice: number
}

export interface LineMovement {
  id: string
  title: string
  was: number
  now: number
  /** Positive when it went up. Only increases reach the caller as drift. */
  delta: number
}

export interface RepriceThreshold {
  /**
   * Percentage of the authorised total an increase may reach before the
   * customer has to be asked again. Zero means any increase.
   */
  percent: number
  /** Absolute increase allowed regardless of percentage. Zero means any. */
  amount: number
}

/**
 * The conservative default.
 *
 * Any real increase requires asking again. A dealership can loosen it to their
 * own state's rule with their own advice; nobody gets hurt by a system that
 * asks too often, and the reverse is a bill somebody disputes.
 */
export const STRICT_THRESHOLD: RepriceThreshold = { percent: 0, amount: 0 }

/**
 * Below this, a difference is rounding rather than a price change.
 *
 * Money is stored to two decimals and totals are summed from lines, so a
 * penny of float drift must not put a customer through a re-authorisation.
 */
const ROUNDING_TOLERANCE = 0.01

export type RepriceVerdict = 'UNCHANGED' | 'CHEAPER' | 'NEEDS_REAUTHORISATION' | 'WITHIN_TOLERANCE'

export interface RepriceReport {
  verdict: RepriceVerdict
  authorisedTotal: number
  currentTotal: number
  /** Positive when the customer would now pay more. */
  increase: number
  /** Lines that went up, worst first. */
  increases: LineMovement[]
  /** Lines that came down. Shown to the advisor, never a reason to re-ask. */
  decreases: LineMovement[]
  /** Authorised lines that are no longer on the sheet and cannot be billed. */
  disappeared: PricedLine[]
  /** One sentence for the advisor. */
  summary: string
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

/**
 * Compare what the customer agreed to against what it costs now.
 *
 * `authorised` comes from the frozen snapshot — the prices that were on the
 * customer's screen — and never from today's op codes. That is the whole
 * point: the question is whether the number changed since they looked at it.
 */
export function comparePrices(
  authorised: PricedLine[],
  current: PricedLine[],
  threshold: RepriceThreshold = STRICT_THRESHOLD,
): RepriceReport {
  const currentById = new Map(current.map((l) => [l.id, l]))

  const increases: LineMovement[] = []
  const decreases: LineMovement[] = []
  const disappeared: PricedLine[] = []

  let authorisedTotal = 0
  let currentTotal = 0

  for (const was of authorised) {
    authorisedTotal += was.customerPrice
    const now = currentById.get(was.id)

    if (!now) {
      // Cannot be billed, so there is nothing to re-authorise. It comes off
      // the current total, which can only ever help the customer.
      disappeared.push(was)
      continue
    }

    currentTotal += now.customerPrice
    const delta = now.customerPrice - was.customerPrice
    if (Math.abs(delta) < ROUNDING_TOLERANCE) continue

    const movement: LineMovement = {
      id: was.id,
      title: now.title,
      was: was.customerPrice,
      now: now.customerPrice,
      delta,
    }
    if (delta > 0) increases.push(movement)
    else decreases.push(movement)
  }

  increases.sort((a, b) => b.delta - a.delta)
  decreases.sort((a, b) => a.delta - b.delta)

  const increase = currentTotal - authorisedTotal

  if (increase <= ROUNDING_TOLERANCE) {
    const cheaper = increase < -ROUNDING_TOLERANCE
    return {
      verdict: cheaper ? 'CHEAPER' : 'UNCHANGED',
      authorisedTotal, currentTotal, increase, increases, decreases, disappeared,
      summary: cheaper
        ? `Now ${money(Math.abs(increase))} less than authorised. No need to ask again.`
        : 'Prices are unchanged since they authorised.',
    }
  }

  /*
    Both limits have to be cleared for an increase to pass without asking.

    Either alone is a loophole: a percentage alone waves through a large
    increase on a large ticket, and an amount alone waves through a small
    ticket doubling.
  */
  const allowedByPercent = authorisedTotal * (threshold.percent / 100)
  const withinTolerance =
    increase <= allowedByPercent + ROUNDING_TOLERANCE &&
    increase <= threshold.amount + ROUNDING_TOLERANCE

  if (withinTolerance) {
    return {
      verdict: 'WITHIN_TOLERANCE',
      authorisedTotal, currentTotal, increase, increases, decreases, disappeared,
      summary: `Up ${money(increase)}, inside this store's tolerance. Worth mentioning when they collect.`,
    }
  }

  const worst = increases[0]
  return {
    verdict: 'NEEDS_REAUTHORISATION',
    authorisedTotal, currentTotal, increase, increases, decreases, disappeared,
    summary:
      `${money(increase)} more than ${money(authorisedTotal)} they authorised` +
      (worst ? `, mostly ${worst.title} (${money(worst.was)} → ${money(worst.now)})` : '') +
      '. Ask again before this work is done.',
  }
}

/** Does this report stop the work? */
export function needsReauthorisation(report: RepriceReport): boolean {
  return report.verdict === 'NEEDS_REAUTHORISATION'
}
