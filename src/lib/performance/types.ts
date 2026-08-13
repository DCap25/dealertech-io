/**
 * Advisor performance types.
 *
 * Private by construction: every metric here is scoped to one advisor and is
 * about their own process, not a ranking against colleagues. Nothing in this
 * layer knows another advisor exists.
 */

export type OpportunityOutcome = 'ACCEPTED' | 'DECLINED' | 'SKIPPED'

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
