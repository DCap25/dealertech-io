/**
 * Advisor performance types.
 *
 * Private by construction: every metric here is scoped to one advisor and is
 * about their own process, not a ranking against colleagues. Nothing in this
 * layer knows another advisor exists.
 */

/**
 * What became of one ranked opportunity on one visit.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE ARE FOUR
 * ---------------------------------------------------------------------------
 * There were three, and the missing one was the most valuable answer a
 * customer gives. `CALL_ME` — "do the brakes, skip the tyres, and call me
 * about the alignment" — reached this layer through `toOutcome`'s `default`
 * branch and was durably written as `SKIPPED`, which means *nobody raised it*.
 * So the one thread an owning advisor should be pulling on came back off the
 * record as a conversation that never happened, the capture rate counted a
 * presented item as unpresented, and its value was reported as money left on
 * the table when it is money still in play.
 *
 * The distinctions, stated once because four values invite conflation:
 *
 *  - ACCEPTED — they authorised it. The only answer that authorises work.
 *  - DECLINED — they were asked and said no. A real answer, and the follow-up
 *    cadence exists for it.
 *  - CALL_ME  — they were asked, they believe it, and they are not ready
 *    today. Neither a win nor a loss: an open thread with a name on it.
 *  - SKIPPED  — nobody asked. The advisor's own gap, and the only one of the
 *    four that a capture rate is measuring.
 *
 * Every consumer in this folder treats CALL_ME deliberately; grep it here
 * before adding a fifth.
 */
export type OpportunityOutcome = 'ACCEPTED' | 'DECLINED' | 'CALL_ME' | 'SKIPPED'

/** One decision on one ranked opportunity, as recorded at the drive. */
export interface OutcomeRecord {
  appointmentId: string
  opportunityKey: string
  opportunityType: string
  title: string
  urgency: string
  likelyPayer: string
  estimatedAmount: number
  customerOutOfPocket: number
  outcome: OpportunityOutcome
  decidedAt: Date
}

/**
 * Money that actually landed on a repair order.
 *
 * Kept separate from outcomes because it comes from a different, harder
 * source — sold RO lines. An advisor's capture rate is about process; this is
 * about result, and conflating the two hides which one is slipping.
 */
export interface SoldLineRecord {
  repairOrderId: string
  closedAt: Date
  /** Total ticket for the line. */
  amount: number
  /** What the customer paid. The remainder was carried by coverage. */
  customerAmount: number
  payType: string
}

export interface Period {
  start: Date
  /** Exclusive. */
  end: Date
  label: string
}

export interface Metric {
  key: string
  label: string
  /** Formatted for display — the pure layer decides units, the UI just prints. */
  display: string
  /** Raw value, for trend maths and tests. */
  value: number
  /** Percentage-point or percent change vs the previous period, null if no basis. */
  changePercent: number | null
  /** Whether up is good. Every metric here happens to be, but say it explicitly. */
  higherIsBetter: boolean
  /** One line explaining what the number actually counts. */
  explanation: string
  /** How many records it was computed from — an honest small-sample warning. */
  sampleSize: number
}

export interface Insight {
  key: string
  /** CELEBRATE for something genuinely earned, COACH for a fixable gap. */
  tone: 'CELEBRATE' | 'COACH' | 'NEUTRAL'
  headline: string
  detail: string
  /** Higher shows first. */
  weight: number
}

export interface Streak {
  key: string
  label: string
  /** Consecutive qualifying visits, most recent first. */
  current: number
  best: number
  detail: string
}

export interface Scorecard {
  period: Period
  metrics: Metric[]
  insights: Insight[]
  streaks: Streak[]
  /** Visits with a worked prep sheet in this period. */
  visitsWorked: number
  /** Personal best marker — beat your own previous best, nobody else's. */
  personalBest: { metricKey: string; label: string } | null
}
