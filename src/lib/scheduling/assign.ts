import { countByAdvisor, type AdvisorOnDuty, type ScheduledAppointment } from './capacity'

/**
 * Whose customer is this — DRIVE_PLAN D4, as a pure decision.
 *
 * ---------------------------------------------------------------------------
 * A CASCADE WITH AN AUDIT TRAIL, NOT A RULE
 * ---------------------------------------------------------------------------
 * Advisor continuity is a retention lever — a customer who "has a guy" comes
 * back to the guy — and it competes with load balance (the senior advisor
 * accretes everyone) and with shift reality (their guy is off Tuesdays). No
 * single rule survives all three, so assignment is four steps in order, and
 * every appointment records which step produced it.
 *
 * That record is the point as much as the assignment is: an advisor's numbers
 * mean nothing if nobody can say how their book was dealt, and `assignment_
 * reason` is what makes the scorecard defensible and the argument short.
 *
 * Pure and I/O-free.
 */

/**
 * Why this appointment has the advisor it has.
 *
 * Stored as text on `appointments.assignment_reason` (matching the channel
 * column precedent on `presentation_sessions`) rather than as a Postgres enum:
 * this vocabulary is younger than the table and will grow — P3's delivery
 * introduction is a REQUESTED today and may want naming — and a text column
 * costs an `ADD VALUE` migration less each time.
 */
export type AssignmentReason =
  /** The customer asked, or the booker picked. */
  | 'REQUESTED'
  /** Their advisor, from the owning relationship. Not written until P3. */
  | 'OWNING'
  /** Round-robin over the pool, weighted by that day's load. */
  | 'BALANCED'
  /** Left unassigned for whoever claims it at write-up. */
  | 'CLAIMED'
  /**
   * A person moved it after the fact.
   *
   * Never returned by `assignAdvisor` — reassignment is not built in P2. It is
   * named here because the enum is the audit vocabulary, and the reassignment
   * path (self-serve to claim from the pool, manager-gated to take an assigned
   * one) writes into the same trail when it lands.
   */
  | 'MANUAL'

export interface AssignmentDecision {
  advisorId: string | null
  reason: AssignmentReason
}

export interface AssignmentInput {
  /** An explicit pick — the customer asked for them, or the booker chose. */
  requestedAdvisorId?: string | null
  /**
   * The customer's owning advisor.
   *
   * **The P3 seam.** `customers.owning_advisor_id` does not exist yet — it
   * arrives with the delivery introduction in migration 0029, which is the
   * write that first creates the relationship. Every P2 caller passes null, so
   * step 2 is unreachable today; it is built and tested now so that P3 is a
   * loader change and not a change to how assignment decides.
   */
  owningAdvisorId?: string | null
  /** Everyone who could take it. An empty list is a real state — see below. */
  advisors: AdvisorOnDuty[]
  /** That day's book, for weighting. Only the counts are read. */
  dayAppointments: ScheduledAppointment[]
  /** The store setting behind DRIVE_PLAN §9 Q1. False = claim at arrival. */
  autoAssign: boolean
}

/**
 * Run the cascade.
 *
 * Steps 1 and 2 honour the relationship **even when that advisor is off that
 * day**. That is deliberate and it is D4's own instruction: a silent
 * reassignment is the one outcome to avoid, because it takes the decision away
 * from the only person in the conversation who can make it. `capacityWarnings`
 * says so in words and the booker chooses another day or another advisor.
 *
 * An id that names nobody on the roster is ignored rather than honoured — a
 * stale form value or a departed advisor should fall through to the next step,
 * not book a customer to a ghost.
 */
export function assignAdvisor(input: AssignmentInput): AssignmentDecision {
  const known = (id: string | null | undefined): string | null =>
    id && input.advisors.some((a) => a.advisorId === id) ? id : null

  const requested = known(input.requestedAdvisorId)
  if (requested) return { advisorId: requested, reason: 'REQUESTED' }

  const owning = known(input.owningAdvisorId)
  if (owning) return { advisorId: owning, reason: 'OWNING' }

  /*
    The store's own operating model. Some drives are a first-free-writer line
    and pre-assigning them would be the product overruling the store — so this
    is a setting, not a policy (Q1, open, defaulting to auto-assign).
  */
  if (!input.autoAssign) return { advisorId: null, reason: 'CLAIMED' }

  const working = input.advisors.filter((a) => a.working)
  /*
    Nobody to give it to. Reported as CLAIMED rather than as a failure: the
    appointment is real, it lands in the unassigned pool, and somebody picks it
    up at arrival — which is exactly what CLAIMED means everywhere else. The
    reason column stays honest about the outcome; it does not claim a balance
    was struck over an empty roster.
  */
  if (working.length === 0) return { advisorId: null, reason: 'CLAIMED' }

  /*
    Deliberately boring. Fewest write-ups already on the book that day wins;
    ties break by name so the same inputs always produce the same answer and a
    test can assert it. Skill-based or gross-weighted routing is tuning nobody
    asked for and is the kind of rule advisors learn to game.
  */
  const counts = countByAdvisor(input.dayAppointments)
  const best = [...working].sort((a, b) => {
    const load = (counts.get(a.advisorId) ?? 0) - (counts.get(b.advisorId) ?? 0)
    return load !== 0 ? load : a.name.localeCompare(b.name)
  })[0]!

  return { advisorId: best.advisorId, reason: 'BALANCED' }
}

/**
 * Who chose, for the audit row — the other half of `assignment_reason`.
 *
 * ---------------------------------------------------------------------------
 * WHY SYSTEM IS NULL AND NOT A SENTINEL
 * ---------------------------------------------------------------------------
 * D4 says the trail records `assigned_by` as "user or SYSTEM". A sentinel uuid
 * standing for SYSTEM would need either a fake row in `users` — a login-shaped
 * thing that is not a person, which every join and every roster screen then has
 * to know to hide — or a foreign key that does not resolve. Null says the same
 * thing and says it in the type: **nobody chose; the rule did.** Which rule is
 * already in `assignment_reason`, so no information is lost.
 *
 * Note this is not `created_by`, which exists already and is always the person
 * who booked. The pair is the useful one: "Priya booked it, the balancer chose
 * Marcus" is two facts, and the argument that follows is about the second.
 */
export function assignedBy(reason: AssignmentReason, bookerUserId: string): string | null {
  return reason === 'REQUESTED' || reason === 'MANUAL' ? bookerUserId : null
}
