/**
 * What a customer can answer, and what each answer is worth.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE ARE THREE
 * ---------------------------------------------------------------------------
 * Yes and no is not how anybody actually answers a menu. The real sentence is
 * "do the brakes, skip the tyres, and call me about the alignment" — and the
 * third clause is the most valuable thing said in the whole conversation. It is
 * somebody who believes the recommendation and is not ready to commit, which is
 * a different person entirely from somebody who said no.
 *
 * Collapsing it into a decline throws away the highest-intent lead on the
 * sheet and, worse, tells the follow-up engine to treat a warm customer like a
 * cold one. Collapsing it into an acceptance is a good way to do work nobody
 * authorised.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------
 * The product exists because customers assume a service advisor is inventing
 * work. Every choice here is made against that: the wording is the customer's
 * own answer read back to them, not a sales stage, and "not today" is offered
 * as plainly as "yes" rather than buried. An advisor who is trusted sells more
 * over a customer's lifetime than one who wins the argument today.
 *
 * Pure and I/O-free.
 */

export type Decision = 'ACCEPTED' | 'DECLINED' | 'CALL_ME' | 'PENDING'

export const DECISIONS: {
  code: Decision
  /** What the customer taps. Their words, not ours. */
  customerLabel: string
  /** What the advisor sees afterwards. */
  advisorLabel: string
}[] = [
  { code: 'ACCEPTED', customerLabel: 'Yes, do it', advisorLabel: 'Approved' },
  {
    code: 'CALL_ME',
    // Not "maybe" and not "think about it". Both of those read as a polite no
    // and get worked like one. This is a request, and it should be answered.
    customerLabel: 'Call me about this',
    advisorLabel: 'Wants to talk',
  },
  { code: 'DECLINED', customerLabel: 'Not today', advisorLabel: 'Declined' },
]

const VALID = new Set<string>(['ACCEPTED', 'DECLINED', 'CALL_ME', 'PENDING'])

export function isDecision(value: unknown): value is Decision {
  return typeof value === 'string' && VALID.has(value)
}

/** Answers that authorise work. Only one, and deliberately so. */
export function isAuthorised(decision: Decision): boolean {
  return decision === 'ACCEPTED'
}

/**
 * Does this answer belong on the follow-up list?
 *
 * Both a decline and a call-me do, for different reasons and at different
 * urgency — see `followUpPriority`. A pending item does not: nobody answered
 * it, so there is nothing to follow up on and chasing it would be chasing our
 * own failure to ask.
 */
export function needsFollowUp(decision: Decision): boolean {
  return decision === 'DECLINED' || decision === 'CALL_ME'
}

/**
 * How soon somebody should act, lower being sooner.
 *
 * A call-me outranks a decline by a wide margin. They asked to be contacted;
 * leaving that for the usual decline cadence is both a lost sale and, from the
 * customer's side, being ignored after asking a direct question.
 */
export function followUpPriority(decision: Decision): number {
  switch (decision) {
    case 'CALL_ME': return 0
    case 'DECLINED': return 100
    default: return Number.POSITIVE_INFINITY
  }
}

/**
 * Only ids that were actually presented.
 *
 * A client posting an id it was never sent is either broken or being probed,
 * and either way the answer is to drop it rather than record a decision
 * against work nobody was shown.
 */
export function sanitizeDecisions(
  presentedIds: Iterable<string>,
  incoming: unknown,
): Record<string, Decision> {
  const allowed = new Set(presentedIds)
  const out: Record<string, Decision> = {}
  if (!incoming || typeof incoming !== 'object') return out

  for (const [id, value] of Object.entries(incoming as Record<string, unknown>)) {
    if (!allowed.has(id)) continue
    if (isDecision(value)) out[id] = value
  }
  return out
}

export interface DecisionTotals {
  accepted: number
  declined: number
  callMe: number
  pending: number
  /** Money the customer said yes to, at the price they were shown. */
  authorisedAmount: number
}

/**
 * Totals for the advisor, from the prices actually presented.
 *
 * Priced from the snapshot rather than from today's op codes on purpose. What
 * the customer agreed to is what was on the screen in front of them; if the
 * price has moved since, that is a re-authorisation conversation and not a
 * number to quietly update behind them.
 */
export function totalDecisions(
  items: { id: string; customerPrice: number }[],
  decisions: Record<string, Decision>,
): DecisionTotals {
  const totals: DecisionTotals = {
    accepted: 0, declined: 0, callMe: 0, pending: 0, authorisedAmount: 0,
  }

  for (const item of items) {
    const decision = decisions[item.id] ?? 'PENDING'
    switch (decision) {
      case 'ACCEPTED':
        totals.accepted += 1
        totals.authorisedAmount += item.customerPrice
        break
      case 'DECLINED': totals.declined += 1; break
      case 'CALL_ME': totals.callMe += 1; break
      default: totals.pending += 1
    }
  }
  return totals
}
