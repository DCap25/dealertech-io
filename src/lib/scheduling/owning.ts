/**
 * Whose customer this is — DRIVE_PLAN D6's relationship half, as a pure
 * decision.
 *
 * ---------------------------------------------------------------------------
 * A RELATIONSHIP THE SYSTEM MOVES ON ITS OWN IS NOT ONE
 * ---------------------------------------------------------------------------
 * `customers.owning_advisor_id` is what makes step 2 of the assignment cascade
 * reachable and "my customers" a query rather than a guess. It is worth
 * exactly as much as its discipline: it is written at the two moments the
 * relationship actually forms, and never rewritten by traffic. If Tuesday's
 * balancer could reassign it, the column would degrade into "whoever wrote the
 * last ticket" — which every DMS already knows and nobody trusts.
 *
 * So the write is a claim on empty ground and nothing else. That single rule is
 * why this is a function and not an `if` inside a transaction: it is the rule
 * the whole feature rests on, and it should be provable without a database.
 *
 * Pure and I/O-free.
 */

/**
 * How a customer came to have this advisor.
 *
 * Stored as text on `customers.owning_advisor_source`, matching
 * `assignment_reason` and the `presentation_sessions.channel` precedent — a
 * young vocabulary on an old table.
 */
export type OwningAdvisorSource =
  /** The delivery introduction named them, and nobody owned the customer yet. */
  | 'SALES_INTRO'
  /** They served the first visit, and nobody owned the customer yet. */
  | 'FIRST_VISIT'
  /**
   * The customer asked for them by name.
   *
   * **Not built.** A booker can already request an advisor for one
   * appointment — that is `assignment_reason: REQUESTED` on the appointment —
   * but turning a request into the standing relationship is a decision
   * somebody has to make deliberately, and there is no surface that asks. It
   * is named because this is the vocabulary; writing it would need a screen.
   */
  | 'REQUESTED'
  /**
   * A manager set it.
   *
   * **Not built.** D6 says the relationship is editable by a manager and P3
   * does not build that screen. Named now so the day it lands it writes these
   * same words into this same column instead of inventing a second set — the
   * same reason `MANUAL` is named in `AssignmentReason` without being
   * returned by `assignAdvisor`.
   */
  | 'MANAGER_SET'

/** What to write, when there is something to write. */
export interface OwnershipClaim {
  advisorId: string
  source: OwningAdvisorSource
  since: Date
}

export interface OwnershipInput {
  /** `customers.owning_advisor_id` as it stands. Null is the ordinary case. */
  currentOwnerId: string | null | undefined
  /** Who would become the owner — the introduced advisor, or the one who served. */
  advisorId: string | null | undefined
  source: OwningAdvisorSource
  /** When the relationship formed. Passed in so the decision has no clock. */
  at: Date
}

/**
 * Should this moment create the relationship?
 *
 * Three answers, and only the third writes anything:
 *
 *  - **No advisor.** An introduction where the salesperson named nobody, or a
 *    visit that ran out of the unassigned pool and never got claimed. Nothing
 *    to record — see the note below on why this is the right answer for the
 *    introduction specifically.
 *  - **Already owned.** Never reassign, and that includes re-affirming the
 *    same advisor: re-stamping `since` on every visit would turn "your
 *    customer since March" into "your customer since Tuesday", which quietly
 *    destroys the only fact the column carries beyond the id.
 *  - **Empty ground.** Claim it.
 *
 * On an introduction with no advisor named, doing nothing is a decision rather
 * than an omission: the relationship forms at the first visit instead, with
 * whoever actually greets them (`FIRST_VISIT`). The alternative — assigning
 * the balancer's pick as the owner at booking time — would hand a customer a
 * "their guy" they have never met and who may not be the person who ends up
 * shaking their hand, which is the fake relationship this whole column exists
 * to avoid.
 */
export function shouldClaimOwnership(input: OwnershipInput): OwnershipClaim | null {
  if (!input.advisorId) return null
  if (input.currentOwnerId) return null
  return { advisorId: input.advisorId, source: input.source, since: input.at }
}
