import type { Opportunity } from '@/lib/prep-sheet'
import type { OpportunityDecision } from '@/lib/prep-sheet/presentation'
import { estimateGross } from '@/lib/prep-sheet/presentation'
import type { OpportunityOutcome, OutcomeRecord } from './types'
import { isEasyYes } from './metrics'

/**
 * The private card an advisor sees when they finish a visit.
 *
 * Pure, so it renders instantly from state the Drive already holds — no round
 * trip while a customer is still standing there. Nothing here is shown to the
 * customer or to anyone else in the store.
 */

export interface VisitSummary {
  presented: number
  available: number
  capturePercent: number
  acceptedValue: number
  /** What coverage carried on the accepted work — savings for them, revenue for the store. */
  coveredUnlocked: number
  acceptedGross: number
  /** Value of everything never raised. */
  leftOnTable: number
  /** Present when something worth naming was skipped. */
  coaching: string | null
  /** Present when the visit was genuinely well worked. */
  praise: string | null
}

/** UI decisions map onto recorded outcomes; PENDING means never worked. */
export function toOutcome(decision: OpportunityDecision): OpportunityOutcome {
  switch (decision) {
    case 'ACCEPTED':
      return 'ACCEPTED'
    case 'DECLINED':
      return 'DECLINED'
    case 'CALL_ME':
      /*
        Recorded as itself, which it was not until now.

        This case used to fall through to the branch below, so the customer's
        highest-intent answer was stored as "never raised" — a sentence that is
        false about the advisor and useless to whoever reads the timeline two
        months later. Named explicitly rather than left to `default` so a
        future value has to be thought about instead of quietly inheriting the
        same fate.
      */
      return 'CALL_ME'
    default:
      // An item left PENDING at the end of a visit was never raised — the same
      // thing as skipping it, and counted as such rather than quietly dropped.
      return 'SKIPPED'
  }
}

export function toOutcomeRecords(
  appointmentId: string,
  opportunities: Opportunity[],
  decisions: Record<string, OpportunityDecision>,
  decidedAt: Date,
): OutcomeRecord[] {
  return opportunities.map((o) => ({
    appointmentId,
    opportunityKey: o.id,
    opportunityType: o.type,
    title: o.title,
    urgency: o.urgency,
    likelyPayer: o.likelyPayer,
    estimatedAmount: o.estimatedAmount,
    customerOutOfPocket: o.customerOutOfPocket,
    outcome: toOutcome(decisions[o.id] ?? 'PENDING'),
    decidedAt,
  }))
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

export function buildVisitSummary(
  opportunities: Opportunity[],
  decisions: Record<string, OpportunityDecision>,
): VisitSummary {
  const records = toOutcomeRecords('visit', opportunities, decisions, new Date(0))

  /*
    Both lines split on SKIPPED and nothing else, which is now the whole point.
    A call-me was raised, so it is presented; it is not a miss, so it never
    reaches the coaching line below and never counts as money left on the
    table. Before `CALL_ME` existed as an outcome it did both, and the advisor
    was coached for the best answer they got all morning.
  */
  const available = records.length
  const presented = records.filter((r) => r.outcome !== 'SKIPPED').length
  const skipped = records.filter((r) => r.outcome === 'SKIPPED')

  const accepted = opportunities.filter((o) => decisions[o.id] === 'ACCEPTED')
  const acceptedValue = accepted.reduce((s, o) => s + o.estimatedAmount, 0)
  const coveredUnlocked = accepted.reduce(
    (s, o) => s + Math.max(0, o.estimatedAmount - o.customerOutOfPocket),
    0,
  )
  const acceptedGross = accepted.reduce((s, o) => s + estimateGross(o.estimatedAmount), 0)

  // Coaching names the single most expensive miss, in the order that matters:
  // safety first, then work the customer would barely have paid for, then
  // sheer value. One line, not a list — this is read in ten seconds.
  const skippedSafety = skipped.find((r) => r.urgency === 'SAFETY')
  const skippedEasy = skipped.filter(isEasyYes).sort((a, b) => b.estimatedAmount - a.estimatedAmount)[0]
  const skippedBiggest = [...skipped].sort((a, b) => b.estimatedAmount - a.estimatedAmount)[0]

  let coaching: string | null = null
  if (skippedSafety) {
    coaching = `${skippedSafety.title} was a safety item and never came up. Worth raising even when you expect a no — the record of having said it protects everyone.`
  } else if (skippedEasy) {
    coaching = `${skippedEasy.title} would have cost them ${
      skippedEasy.customerOutOfPocket === 0 ? 'nothing' : money(skippedEasy.customerOutOfPocket)
    } — coverage had it. That is the cheapest yes on the sheet.`
  } else if (skippedBiggest && skippedBiggest.estimatedAmount >= 500) {
    coaching = `${skippedBiggest.title} (${money(
      skippedBiggest.estimatedAmount,
    )}) never came up. It will resurface on the follow-up cadence, but it is worth more today with the car already here.`
  }

  const praise =
    available > 0 && presented === available
      ? coveredUnlocked > 0
        ? `Everything on the sheet was presented, and ${money(coveredUnlocked)} of it was carried by coverage rather than by the customer.`
        : 'Everything on the sheet was presented. That is the part you control, done in full.'
      : null

  return {
    presented,
    available,
    capturePercent: available === 0 ? 0 : (presented / available) * 100,
    acceptedValue,
    coveredUnlocked,
    acceptedGross,
    leftOnTable: skipped.reduce((s, r) => s + r.estimatedAmount, 0),
    coaching,
    praise,
  }
}
