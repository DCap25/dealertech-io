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

import type { PricedLine } from './reprice'

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

/**
 * Put an optimistic tap back the way it was.
 *
 * A customer's screen answers instantly and tells the server afterwards, which
 * is right on a phone with two bars. When the server refuses — the link expired
 * while the tab sat open, the advisor closed the list — the answer on screen is
 * one the record does not have, and leaving it lit under a banner that says the
 * link has expired is the same silence in miniature.
 *
 * `undefined` is not `PENDING`. Pending is an answer the customer took back and
 * the server has; undefined is an item they had never touched, and the key has
 * to go rather than be written as a decision nobody made.
 */
export function revertDecision(
  decisions: Record<string, Decision>,
  id: string,
  previous: Decision | undefined,
): Record<string, Decision> {
  if (previous !== undefined) return { ...decisions, [id]: previous }

  const out = { ...decisions }
  delete out[id]
  return out
}

/**
 * One presentation's answers, as they sit on the row.
 *
 * `decisions` is deliberately `unknown`: it comes out of a jsonb column that
 * anything could have written, and it is validated here against the ids that
 * presentation actually showed rather than assumed to be well formed.
 */
export interface PresentedAnswers {
  /** Which conversation on the visit this was. 1 at write-up, 2 after the MPI. */
  sequence: number
  /** The ids on that presentation's frozen snapshot. */
  presentedIds: Iterable<string>
  /** The `decisions` column, unvalidated. */
  decisions: unknown
}

/**
 * Everything the customer answered across a visit, as one map.
 *
 * A visit has more than one conversation by design — a menu at write-up and
 * another after the technician has been under the car — and each is its own
 * row starting from `{}`. So the answers have to be read together, and where
 * the two overlap the later conversation is the one that happened last and
 * therefore the one that stands.
 *
 * Merged in sequence order, oldest first, later wins per id. An item that was
 * only on the earlier menu keeps its earlier answer: a second presentation
 * that does not mention a line is silent about it, not a retraction.
 *
 * `PENDING` passes through like any other answer, because on a customer's
 * screen it is one — tapping the same button twice clears the choice
 * (`service-menu.tsx:53`), and somebody taking an answer back at two o'clock
 * has said something about the line. What must not happen with it is further
 * down, in `answersToApply`.
 *
 * Ties on `sequence` keep the order they arrived in, so a caller that reads
 * oldest-first gets oldest-first. Both channels now number their presentations
 * off the same count (F10), so a tie is no longer the ordinary case — but it is
 * still a real one: every tablet row written before that fix claims to be the
 * first conversation, and two menus pushed for one visit in the same instant
 * can still read the same maximum and land on the same number.
 */
export function mergeCustomerAnswers(
  presentations: PresentedAnswers[],
): Record<string, Decision> {
  const merged: Record<string, Decision> = {}
  for (const presentation of [...presentations].sort((a, b) => a.sequence - b.sequence)) {
    Object.assign(merged, sanitizeDecisions(presentation.presentedIds, presentation.decisions))
  }
  return merged
}

/**
 * Which of those answers may land on the advisor's decision state.
 *
 * Two rules, both about not overwriting somebody with somebody else.
 *
 * `PENDING` is dropped. On the customer's screen it means they cleared their
 * choice; on the advisor's it means nobody has answered, and writing it there
 * would blank a decision the advisor made themselves and pull the card out of
 * their stack while the totals still counted it as outstanding. An answer that
 * was taken back is an absence, and an absence is what the advisor already has.
 *
 * A line the advisor has already decided themselves is left alone. Both records
 * survive — theirs on the screen, the customer's in the presentation row — and
 * the one an advisor typed while standing at the car is the more recent act.
 * Silently replacing it is the risk that made a plain merge the wrong shape.
 */
export function answersToApply(
  answers: Record<string, Decision>,
  /** Ids the advisor has recorded a decision for. */
  advisorDecided: Iterable<string>,
): Record<string, Exclude<Decision, 'PENDING'>> {
  const theirs = new Set(advisorDecided)
  const out: Record<string, Exclude<Decision, 'PENDING'>> = {}

  for (const [id, decision] of Object.entries(answers)) {
    if (decision === 'PENDING') continue
    if (theirs.has(id)) continue
    out[id] = decision
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

/**
 * An item as a presentation froze it, with the price it carried.
 *
 * Structurally typed rather than `DeviceItem` so this file does not take on the
 * snapshot builder — the only import here is a type from its equally pure
 * sibling. `priceConfirmed` is optional only because these come back out of a
 * jsonb column: every snapshot the builder has ever written sets it
 * (`snapshot.ts`), so an absent field is a shape question rather than a data
 * one.
 */
export interface PresentedItem {
  id: string
  title: string
  /** What the customer owes, as the snapshot froze it. */
  customerOutOfPocket: number
  /** False when the figure is our estimate and the screen said so instead. */
  priceConfirmed?: boolean
}

/**
 * Did the customer's screen actually show this line's price?
 *
 * `!== false` rather than a truthiness test, matching every surface that
 * decides what a customer sees: the tablet footer (`tablet.tsx`), the phone
 * footer (`customer-menu.tsx`), and both renderers (`service-menu.tsx`,
 * `printable-menu.tsx`) all key off `priceConfirmed === false`. These totals
 * exist to say what was on the screen, so on the one input the screen reads
 * they have to answer the same way it does — a snapshot missing the field
 * renders its price, and therefore counts.
 */
function priceWasShown(item: PresentedItem): boolean {
  return item.priceConfirmed !== false
}

/**
 * What the customer said yes to, at prices they were actually shown.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PRICE FILTER IS HERE AND NOT AT THE CALL SITE
 * ---------------------------------------------------------------------------
 * Every total in the system excludes unpriced lines — the snapshot's own
 * (`selection.ts`), all four surface footers, and the audit row written with
 * the authorisation itself (`link-store.ts`, `MENU_AUTHORISED`). The two reads
 * that feed the permanent DMS record did not, and they are the two that make a
 * claim about a person: the note that says "$X approved at the prices shown"
 * and the "PRICE CHANGED" warning that quotes what they authorised. A customer
 * whose screen read "Price to be confirmed", and whose running total left the
 * item out, tapped Yes — and our estimate went into the record as a figure
 * they had agreed to.
 *
 * So the rule lives in one place both of them call.
 *
 * The *item* is still accepted. Only the money excludes it: a count of accepted
 * items is the customer's answer and must never be price-filtered, which is why
 * the audit row counts `itemsAccepted` whole and filters only its
 * `acceptedAmount`.
 */
export function authorisedLines(
  items: PresentedItem[],
  decisions: Record<string, string | undefined>,
): PricedLine[] {
  return items
    .filter((i) => decisions[i.id] === 'ACCEPTED' && priceWasShown(i))
    .map((i) => ({ id: i.id, title: i.title, customerPrice: i.customerOutOfPocket }))
}

/**
 * The money on those lines — the figure a permanent record attributes to a
 * named person.
 *
 * An accepted line with no price contributes nothing rather than contributing
 * our estimate. Zero is the honest answer: nobody quoted a number, so nobody
 * agreed to one.
 */
export function authorisedTotal(
  items: PresentedItem[],
  decisions: Record<string, string | undefined>,
): number {
  return authorisedLines(items, decisions).reduce((sum, l) => sum + l.customerPrice, 0)
}
