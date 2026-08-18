/**
 * The relationship as one story — DRIVE_PLAN D6.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS
 * ---------------------------------------------------------------------------
 * A read-model and nothing else. Every fact on a timeline is already stored by
 * something that owns it; this folder writes nothing, decides nothing about
 * the business, and adds no table. What it adds is the one thing seven schema
 * files cannot give an advisor standing at a podium: the order events happened
 * in.
 *
 * The shape follows every other engine here — pure assembly (`assemble.ts`,
 * `threads.ts`) over typed loaders (`load.ts`), so the part that decides what a
 * story looks like is testable without a database.
 *
 * ---------------------------------------------------------------------------
 * IDENTITY
 * ---------------------------------------------------------------------------
 * `id` is `source:rowId` — the table an event came from and the primary key it
 * came from — plus a third segment where one row is genuinely two moments in
 * time (a repair order opens and later closes; a cadence task fires and later
 * completes). React keys built from array positions go wrong the moment two
 * sources interleave differently, and a timeline is nothing but interleaving.
 *
 * The one deliberate exception is `VISIT_OUTCOMES`, whose `rowId` is an
 * appointment id rather than a `prep_sheet_outcomes` id — see `assemble.ts`.
 */

/** The ten tables D6 names, and nothing else may appear here. */
export type TimelineSource =
  | 'appointments'
  | 'presentation_sessions'
  | 'repair_orders'
  | 'ro_lines'
  | 'declined_services'
  | 'prep_sheet_outcomes'
  | 'dms_handoffs'
  | 'call_logs'
  | 'cadence_tasks'
  | 'customer_notes'
  | 'mileage_readings'

/**
 * What kind of thing happened, for rendering.
 *
 * Coarser than the source list on purpose: `ro_lines` never produces an event
 * of its own — a line is detail on the repair order that carries it — and a
 * screen that had to know eleven event shapes would grow eleven branches that
 * drift apart.
 */
export type TimelineKind =
  | 'APPOINTMENT'
  | 'MENU'
  | 'REPAIR_ORDER'
  | 'DECLINE'
  | 'VISIT_OUTCOMES'
  | 'HANDOFF'
  | 'CALL'
  | 'TASK'
  | 'NOTE'
  | 'MILEAGE'

/**
 * How a screen should colour it.
 *
 * Three values, because a timeline that colours everything is a timeline
 * nobody scans. GOOD is money or goodwill landing; WARN is something that went
 * wrong or is still owed; NEUTRAL is most of history.
 */
export type TimelineTone = 'NEUTRAL' | 'GOOD' | 'WARN'

export interface TimelineEvent {
  /** `source:rowId`, plus a moment discriminator where one row is two events. */
  id: string
  source: TimelineSource
  rowId: string
  kind: TimelineKind
  /** When it happened. The only thing the merge sorts on. */
  at: Date
  /**
   * The car this was about, or null for something about the customer.
   *
   * Derived where the source row does not carry one: a presentation and a
   * hand-off know only an appointment, and the appointment knows the vehicle.
   * Null is a real answer — a thank-you call is about a person.
   */
  vehicleId: string | null
  /** One line, already written for a human. */
  title: string
  /** Secondary lines, already written. Never more than a handful. */
  detail: string[]
  /** Money on the event, or null when it carries none. */
  amount: number | null
  tone: TimelineTone
  /** Where the event leads, when it leads anywhere. */
  href: string | null
}

/** Events that happened on one calendar day, newest day first. */
export interface TimelineDay {
  /** `YYYY-MM-DD` in the rendering locale — a stable key as well as a label. */
  key: string
  at: Date
  events: TimelineEvent[]
}

// ===========================================================================
// OPEN THREADS
// ===========================================================================

/**
 * Why somebody is still owed a conversation.
 *
 * `CALL_ME` is its own kind rather than a flag on a decline, because the whole
 * point of the vocabulary work in this phase is that the two are not the same
 * answer and must never be worked as one.
 */
export type ThreadKind = 'CALL_ME' | 'MENU_DECLINE' | 'OPEN_DECLINE' | 'CADENCE_TASK'

export interface OpenThread {
  /** `source:rowId:key`, stable for the same reasons `TimelineEvent.id` is. */
  id: string
  kind: ThreadKind
  /**
   * Lower is sooner, on one scale shared with `followUpPriority` in
   * src/lib/presentation/decisions.ts and with `cadence_tasks.priority`.
   * All three already agree that lower means sooner; see `threads.ts`.
   */
  priority: number
  /** When the thread was opened. Ties on priority break on this, newest first. */
  at: Date
  title: string
  detail: string | null
  /** What it is worth, or null when nobody has priced it. */
  amount: number | null
  vehicleId: string | null
  vehicleLabel: string | null
  href: string | null
}

// ===========================================================================
// BOUNDS
// ===========================================================================

/**
 * How far back each source is read.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE ARE BOUNDS AT ALL
 * ---------------------------------------------------------------------------
 * A customer who has been coming here since 2014 has hundreds of mileage
 * readings and dozens of cadence tasks, and none of the ones from 2016 change
 * what an advisor does this morning. Unbounded, this read-model would get
 * slower every year for every customer, which is the failure mode where a CRM
 * becomes the thing nobody opens.
 *
 * Row counts rather than a since-date, deliberately. A date cuts off the
 * customer who comes once every two years and leaves the fleet account with
 * four hundred rows; a count gives both of them the same amount of history to
 * read and the same cost to load.
 *
 * The numbers are chosen so that a normal customer — two visits a year — is
 * fully covered for the whole life of a car, and the abnormal one is truncated
 * rather than allowed to cost unbounded time.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE WHOLE THING COSTS
 * ---------------------------------------------------------------------------
 * Constant, not proportional to history: the visit-shaped sources
 * (presentations, hand-offs, outcomes) are fetched by the appointment ids
 * already loaded rather than by their own windows, and `ro_lines` by the
 * repair-order ids already loaded. So a decade-old customer costs the same
 * queries as a new one — see `load.ts` for the count.
 */
export const TIMELINE_BOUNDS = {
  /** ~20 years for a twice-a-year customer. */
  appointments: 40,
  repairOrders: 40,
  /** Higher: several can come off one visit. */
  declines: 60,
  callLogs: 40,
  cadenceTasks: 40,
  notes: 40,
  /** One per visit plus DMS pulls, so the noisiest of the ten. */
  mileageReadings: 40,
} as const

// ===========================================================================
// SOURCE ROWS
// ===========================================================================

/**
 * What the loaders hand the pure assembly.
 *
 * Written out rather than inferred from the Drizzle schema so the assembly can
 * be tested with plain objects, and so a column added to a table does not
 * silently become part of this module's contract.
 */

export interface TimelineAppointment {
  id: string
  vehicleId: string | null
  scheduledAt: Date
  promisedAt: Date | null
  status: string
  source: string
  transportType: string
  concerns: string | null
  visitContext: string | null
  cancelledAt: Date | null
  cancellationReason: string | null
  advisorName: string | null
}

export interface TimelinePresentation {
  id: string
  appointmentId: string | null
  /** TABLET | LINK | PRINT. */
  channel: string
  sequence: number
  startedAt: Date
  authorizedAt: Date | null
  authorizedName: string | null
  /** jsonb — the menu as pushed. Validated, never trusted. */
  snapshot: unknown
  /** jsonb — the menu as frozen at authorisation, when there was one. */
  authorizedSnapshot: unknown
  /** jsonb — what the customer has tapped. */
  decisions: unknown
}

export interface TimelineRepairOrder {
  id: string
  vehicleId: string
  roNumber: string
  status: string
  openedAt: Date
  closedAt: Date | null
  mileageIn: number | null
  customerPayTotal: number
  advisorName: string | null
  lines: { description: string; payType: string; status: string; customerAmount: number }[]
}

export interface TimelineDecline {
  id: string
  vehicleId: string
  description: string
  quotedAmount: number
  declinedAt: Date
  declineReason: string | null
  resolvedAt: Date | null
}

export interface TimelineOutcome {
  appointmentId: string
  vehicleId: string
  title: string
  outcome: string
  estimatedAmount: number
  decidedAt: Date
}

export interface TimelineHandoff {
  id: string
  appointmentId: string | null
  status: string
  vendor: string
  writesPersisted: boolean
  message: string
  acceptedCount: number
  createdAt: Date
}

export interface TimelineCall {
  id: string
  vehicleId: string | null
  direction: string
  outcome: string | null
  startedAt: Date
  durationSeconds: number | null
  notes: string | null
  userName: string | null
  bookedSomething: boolean
}

export interface TimelineTask {
  id: string
  vehicleId: string | null
  title: string
  detail: string | null
  trigger: string
  status: string
  priority: number
  estimatedValue: number
  dueAt: Date
  createdAt: Date
  completedAt: Date | null
  outcome: string | null
}

export interface TimelineNote {
  id: string
  vehicleId: string | null
  body: string
  isPinned: boolean
  createdAt: Date
  authorName: string | null
}

export interface TimelineMileage {
  id: string
  vehicleId: string
  mileage: number
  recordedAt: Date
  source: string
  overrideReason: string | null
}

/** Everything the pure assembly needs, and nothing that requires a connection. */
export interface TimelineInput {
  appointments: TimelineAppointment[]
  presentations: TimelinePresentation[]
  repairOrders: TimelineRepairOrder[]
  declines: TimelineDecline[]
  outcomes: TimelineOutcome[]
  handoffs: TimelineHandoff[]
  calls: TimelineCall[]
  tasks: TimelineTask[]
  notes: TimelineNote[]
  mileage: TimelineMileage[]
  /** vehicle id → "2022 Toyota Camry". Missing ids render without a label. */
  vehicleLabels: Record<string, string>
}

/** What a record page renders. Both halves come out of one fetch. */
export interface Timeline {
  events: TimelineEvent[]
  threads: OpenThread[]
}

/**
 * The ninety-second version — the compressed card on the prep sheet.
 *
 * Same definitions as the full timeline (it is built by the same pure
 * functions from the same rows), just three facts instead of a history.
 */
export interface VisitCard {
  lastVisit: { at: Date; title: string; href: string | null } | null
  nextVisit: { at: Date; title: string; href: string | null } | null
  threads: OpenThread[]
}
