import type { Metric, OutcomeRecord, Period, SoldLineRecord } from './types'

/**
 * Pure metric calculation. No I/O, no React, no dates fetched from the clock —
 * every function takes its window explicitly so results are reproducible and
 * testable.
 */

export function inPeriod(at: Date, period: Period): boolean {
  return at >= period.start && at < period.end
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

function pct(n: number): string {
  return `${Math.round(n)}%`
}

/**
 * An "easy yes": the customer owes little or nothing because something else is
 * paying. These are the items where a miss is hardest to justify — the work
 * was free or nearly free to the customer and still didn't get raised.
 */
const EASY_YES_MAX_OUT_OF_POCKET_SHARE = 0.25

export function isEasyYes(o: OutcomeRecord): boolean {
  if (o.likelyPayer === 'CUSTOMER_PAY') return false
  if (o.customerOutOfPocket === 0) return true
  if (o.estimatedAmount <= 0) return false
  return o.customerOutOfPocket / o.estimatedAmount <= EASY_YES_MAX_OUT_OF_POCKET_SHARE
}

/**
 * Presented means raised with the customer at all — accepted, declined, or
 * answered with a call-me.
 *
 * Deliberately written as "not skipped" rather than as a list of the three
 * answers, so extending the vocabulary cannot silently drop an answer out of
 * the denominator the way `CALL_ME` used to be dropped out of it upstream.
 * SKIPPED is the one value that means the conversation did not happen, and it
 * is the only thing this metric is asking about.
 */
export function wasPresented(o: OutcomeRecord): boolean {
  return o.outcome !== 'SKIPPED'
}

/**
 * The customer asked to be called back about this.
 *
 * Not a metric on the scorecard, on purpose: "more call-mes" is neither good
 * nor bad — it is a queue, and whether it is healthy depends entirely on
 * whether anyone worked it, which this layer cannot see. It is a *lead list*,
 * which is what the timeline's open threads render it as. What it earns here
 * is a named predicate so nothing has to hand-write the string, and the
 * insight in `insights.ts` that puts a number in front of the advisor.
 */
export function wantsCallBack(o: OutcomeRecord): boolean {
  return o.outcome === 'CALL_ME'
}

/**
 * Share of ranked opportunities the advisor actually raised.
 *
 * The headline process metric, and deliberately not a closing rate: an advisor
 * controls whether they present, not whether the customer says yes. Measuring
 * the part they control is what makes it coachable rather than demoralising.
 */
export function captureRate(outcomes: OutcomeRecord[]): number {
  if (outcomes.length === 0) return 0
  return (outcomes.filter(wasPresented).length / outcomes.length) * 100
}

export function easyYesCaptureRate(outcomes: OutcomeRecord[]): number {
  const easy = outcomes.filter(isEasyYes)
  if (easy.length === 0) return 0
  return (easy.filter(wasPresented).length / easy.length) * 100
}

/**
 * Money a customer did not have to pay because coverage carried it.
 *
 * The number this whole product exists to move, and the one an advisor can be
 * proud of out loud — it is revenue for the store and savings for the customer
 * at the same time.
 */
export function coveredRevenueUnlocked(lines: SoldLineRecord[]): number {
  return lines.reduce((sum, l) => sum + Math.max(0, l.amount - l.customerAmount), 0)
}

/**
 * Total value of everything the advisor never raised.
 *
 * SKIPPED only. A decline is not left on the table — it was offered and
 * refused — and neither is a call-me, which is still live and belongs to the
 * follow-up list rather than to a regret figure.
 */
export function leftOnTable(outcomes: OutcomeRecord[]): number {
  return outcomes
    .filter((o) => o.outcome === 'SKIPPED')
    .reduce((sum, o) => sum + o.estimatedAmount, 0)
}

/**
 * Average sold value per repair order.
 *
 * Attributed by RO rather than by line so one big ticket does not read as
 * several wins.
 */
export function averagePerRepairOrder(lines: SoldLineRecord[]): number {
  const byRo = new Map<string, number>()
  for (const l of lines) {
    byRo.set(l.repairOrderId, (byRo.get(l.repairOrderId) ?? 0) + l.amount)
  }
  if (byRo.size === 0) return 0
  let total = 0
  for (const amount of byRo.values()) total += amount
  return total / byRo.size
}

export function visitsWorked(outcomes: OutcomeRecord[]): number {
  return new Set(outcomes.map((o) => o.appointmentId)).size
}

/**
 * Change against the previous period.
 *
 * Returns null rather than 0 when there is no prior basis — "no change" and
 * "nothing to compare against" are different, and showing a flat arrow for the
 * second one is a lie an advisor will act on.
 */
export function changeVsPrevious(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null
  return ((current - previous) / previous) * 100
}

export interface MetricInputs {
  outcomes: OutcomeRecord[]
  soldLines: SoldLineRecord[]
  previous?: {
    outcomes: OutcomeRecord[]
    soldLines: SoldLineRecord[]
  }
}

export function buildMetrics({ outcomes, soldLines, previous }: MetricInputs): Metric[] {
  const prevOutcomes = previous?.outcomes ?? null
  const prevLines = previous?.soldLines ?? null

  const capture = captureRate(outcomes)
  const easyYes = easyYesCaptureRate(outcomes)
  const covered = coveredRevenueUnlocked(soldLines)
  const avgRo = averagePerRepairOrder(soldLines)

  const easyCount = outcomes.filter(isEasyYes).length
  const roCount = new Set(soldLines.map((l) => l.repairOrderId)).size

  return [
    {
      key: 'captureRate',
      label: 'Opportunity capture',
      display: pct(capture),
      value: capture,
      changePercent: changeVsPrevious(capture, prevOutcomes ? captureRate(prevOutcomes) : null),
      higherIsBetter: true,
      explanation: 'Share of ranked opportunities you actually raised with the customer.',
      sampleSize: outcomes.length,
    },
    {
      key: 'coveredRevenue',
      label: 'Covered revenue unlocked',
      display: money(covered),
      value: covered,
      changePercent: changeVsPrevious(covered, prevLines ? coveredRevenueUnlocked(prevLines) : null),
      higherIsBetter: true,
      explanation: 'Work the customer did not pay for because coverage carried it.',
      sampleSize: soldLines.length,
    },
    {
      key: 'easyYesCapture',
      label: 'Easy-yes capture',
      display: easyCount === 0 ? '—' : pct(easyYes),
      value: easyYes,
      changePercent: changeVsPrevious(
        easyYes,
        prevOutcomes ? easyYesCaptureRate(prevOutcomes) : null,
      ),
      higherIsBetter: true,
      explanation: 'Of the items costing the customer little or nothing, how many you raised.',
      sampleSize: easyCount,
    },
    {
      key: 'averagePerRo',
      label: 'Average per RO',
      display: money(avgRo),
      value: avgRo,
      changePercent: changeVsPrevious(avgRo, prevLines ? averagePerRepairOrder(prevLines) : null),
      higherIsBetter: true,
      explanation: 'Total sold value divided by repair orders you closed.',
      sampleSize: roCount,
    },
  ]
}
