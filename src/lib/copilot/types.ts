/**
 * Co-Pilot types.
 *
 * The Co-Pilot never decides anything. Coverage, pricing and ranking are all
 * settled by the pure engines before a prompt is ever built; the model's only
 * job is to put those facts into words an advisor can say out loud.
 */

export type CopilotIntent =
  | 'EXPLAIN_COVERAGE'
  | 'NEXT_STEP'
  | 'TALK_TRACK'
  | 'OBJECTION'
  | 'FREEFORM'

/** Objections common enough to be one tap rather than typing. */
export const COMMON_OBJECTIONS = [
  "I'll think about it",
  'Too expensive',
  'I need to ask my spouse',
  "I'll get it done somewhere cheaper",
  'Can it wait until next time?',
] as const

export interface CopilotRequest {
  intent: CopilotIntent
  /** Which opportunity the question is about, for the intents that need one. */
  opportunityId?: string
  /** Which coverage ring was tapped, for EXPLAIN_COVERAGE. */
  coverageKey?: string
  objection?: string
  question?: string
}

/** One line of the grounding block. Flat and printable on purpose. */
export interface CopilotCoverageLine {
  key: string
  label: string
  status: string
  detail: string
}

export interface CopilotOpportunityLine {
  id: string
  title: string
  detail: string
  urgency: string
  payer: string
  price: number
  customerOwes: number
  gross: number
  /** PENDING / ACCEPTED / DECLINED / SKIPPED — what the advisor has done so far. */
  decision: string
  easyYes: string[]
  talkTrack: string
}

/**
 * Everything the model is allowed to know about this visit.
 *
 * Built server-side from the prep sheet, never from client input — the client
 * sends an appointment id and the server re-derives the facts. That keeps the
 * grounding honest and stops a tampered payload from putting words in the
 * model's mouth about coverage.
 */
export interface CopilotContext {
  customerName: string
  vehicle: string
  vinLast6: string
  mileage: number
  concern: string | null
  visitCount: number
  lifetimeSpend: number
  alerts: string[]
  coverage: CopilotCoverageLine[]
  opportunities: CopilotOpportunityLine[]
  remainingValue: number
  acceptedValue: number
}

export interface CopilotResult {
  text: string
  /** What the answer was grounded in, shown to the advisor as a source line. */
  source: string
  provider: string
}
