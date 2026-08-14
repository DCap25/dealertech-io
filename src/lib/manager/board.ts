import type { Period } from '@/lib/performance'

/**
 * The service manager's board.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS LAYER IS ALLOWED TO SEE
 * ---------------------------------------------------------------------------
 * Results only: closed repair orders, today's appointments, and the follow-up
 * backlog. It never reads `prep_sheet_outcomes`, and it must not start.
 *
 * That boundary is a product decision rather than an oversight. The advisor
 * scorecard measures *process* — which ranked opportunities were never raised
 * at all — and it only knows that because the advisor worked the prep sheet
 * honestly. They will stop doing that the week they learn a manager is reading
 * it, and then the number is gone for everyone.
 *
 * Revenue on a closed RO is different. It is already on the manager's DMS
 * report; showing it here reveals nothing new and costs nothing. So: results
 * are shared, coaching is private, and the scorecard says which is which.
 *
 * Pure — no I/O, no clock. Every window is passed in.
 */

// ============================================================ inputs

export interface ManagerAdvisor {
  advisorId: string
  name: string
  /**
   * Their role at this store. Managers and directors can write repair orders
   * and many do, so they are candidates for the table — but only once they
   * actually have. See `buildBoard`.
   */
  role: string
}

export interface ManagerAppointment {
  advisorId: string | null
  scheduledAt: Date
  status: string
}

/**
 * One closed repair order, already rolled up from its sold lines.
 *
 * Aggregating in the loader rather than here keeps this layer free of the
 * "which line statuses count as sold" question, which belongs next to the
 * database that stores them.
 */
export interface ManagerRepairOrder {
  repairOrderId: string
  advisorId: string | null
  closedAt: Date
  /** Total ticket across sold lines. */
  sold: number
  /** What the customer paid. The remainder was carried by coverage. */
  customerPay: number
  laborGross: number
  hoursSold: number
}

export interface ManagerFollowUp {
  ownerRole: 'ADVISOR' | 'BDC'
  trigger: string
  dueAt: Date
  estimatedValue: number
}

export interface BoardInput {
  advisors: ManagerAdvisor[]
  appointments: ManagerAppointment[]
  repairOrders: ManagerRepairOrder[]
  followUps: ManagerFollowUp[]
  period: Period
  /** Previous window of the same length, for trend arrows. Optional. */
  previousRepairOrders?: ManagerRepairOrder[]
  /** "Now" for the board — overdue is relative to this, never to the clock. */
  asOf: Date
}

// ============================================================ outputs

export interface AdvisorRow {
  advisorId: string
  name: string
  appointmentsToday: number
  /** Cars physically in the shop right now. */
  activeNow: number
  rosClosed: number
  sold: number
  customerPay: number
  covered: number
  averagePerRo: number
  hoursSold: number
  /**
   * Labor gross divided by hours sold — the number a fixed-ops manager runs
   * the department on. Null below a floor of hours, because dividing by a
   * fraction of an hour produces a headline rate nobody earned.
   */
  effectiveLaborRate: number | null
}

export interface DepartmentTotals {
  rosClosed: number
  sold: number
  customerPay: number
  covered: number
  averagePerRo: number
  hoursSold: number
  effectiveLaborRate: number | null
  /** Percent change in sold value against the previous window, null if none. */
  soldChangePercent: number | null
}

export interface DriveSnapshot {
  total: number
  /** Nobody's name on it — the manager's problem to fix before 8am. */
  unassigned: number
  notArrived: number
  active: number
  finished: number
}

export interface BacklogSnapshot {
  total: number
  overdue: number
  dueToday: number
  /** Estimated value sitting in the backlog. */
  value: number
  byOwner: { ADVISOR: number; BDC: number }
  /** Days overdue on the worst item, 0 when nothing is late. */
  worstOverdueDays: number
}

export type AttentionTone = 'ALERT' | 'WATCH' | 'GOOD'

export interface Attention {
  key: string
  tone: AttentionTone
  headline: string
  detail: string
}

export interface ManagerBoard {
  period: Period
  advisors: AdvisorRow[]
  department: DepartmentTotals
  drive: DriveSnapshot
  backlog: BacklogSnapshot
  attention: Attention[]
}

// ============================================================ helpers

const DAY_MS = 24 * 60 * 60 * 1000

/** Below this, an effective labor rate is arithmetic rather than information. */
const MIN_HOURS_FOR_ELR = 1

/**
 * How many repair orders an advisor needs before we will say anything about
 * their average. Three good tickets and three bad ones is not a trend, and a
 * manager who acts on one will be wrong in front of their team.
 */
const MIN_ROS_FOR_COMPARISON = 5

/** How far below the department average counts as worth a conversation. */
const LAGGING_SHARE = 0.7

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

function sameDay(a: Date, b: Date): boolean {
  return calendarDaysBetween(a, b) === 0
}

/**
 * Whole calendar days from `from` to `to`, ignoring the time of day.
 *
 * Normalised through UTC so an hour lost to daylight saving cannot turn 72
 * days into 71.96 and then, after flooring, into 71.
 */
function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / DAY_MS)
}

function inPeriod(at: Date, period: Period): boolean {
  return at >= period.start && at < period.end
}

/** Statuses that mean the car is physically here and being worked. */
const ACTIVE_STATUSES = new Set(['ARRIVED', 'IN_SERVICE'])
const FINISHED_STATUSES = new Set(['COMPLETED', 'PICKED_UP', 'CLOSED'])

function rollUp(ros: ManagerRepairOrder[]) {
  let sold = 0
  let customerPay = 0
  let laborGross = 0
  let hoursSold = 0
  for (const ro of ros) {
    sold += ro.sold
    customerPay += ro.customerPay
    laborGross += ro.laborGross
    hoursSold += ro.hoursSold
  }
  return {
    rosClosed: ros.length,
    sold,
    customerPay,
    // Never negative: a data error that made a customer "pay" more than the
    // ticket would otherwise print a negative saving on a manager's screen.
    covered: Math.max(0, sold - customerPay),
    averagePerRo: ros.length === 0 ? 0 : sold / ros.length,
    hoursSold,
    effectiveLaborRate: hoursSold >= MIN_HOURS_FOR_ELR ? laborGross / hoursSold : null,
  }
}

// ============================================================ builder

export function buildBoard(input: BoardInput): ManagerBoard {
  const { advisors, appointments, repairOrders, followUps, period, asOf } = input

  const closedInPeriod = repairOrders.filter((ro) => inPeriod(ro.closedAt, period))
  const today = appointments.filter((a) => sameDay(a.scheduledAt, asOf))
  const advisorRole = new Map(advisors.map((a) => [a.advisorId, a.role]))

  // ------------------------------------------------------------ per advisor
  const rows: AdvisorRow[] = advisors.map((advisor) => {
    const mine = today.filter((a) => a.advisorId === advisor.advisorId)
    const totals = rollUp(closedInPeriod.filter((ro) => ro.advisorId === advisor.advisorId))
    return {
      advisorId: advisor.advisorId,
      name: advisor.name,
      appointmentsToday: mine.length,
      activeNow: mine.filter((a) => ACTIVE_STATUSES.has(a.status)).length,
      ...totals,
    }
  })

  /**
   * Advisors always get a row, even a silent one — a quiet advisor is exactly
   * who this page exists to surface, and dropping them hides the answer.
   *
   * Everyone else earns their row by doing the work. A service manager who
   * does not write repair orders would otherwise sit at the bottom of their
   * own board on a permanent line of zeros.
   */
  const visible = rows.filter(
    (r) =>
      advisorRole.get(r.advisorId) === 'ADVISOR' ||
      r.rosClosed > 0 ||
      r.appointmentsToday > 0,
  )

  // Ranked by what they sold. A manager opening this wants the shape of the
  // department, and alphabetical order hides it.
  visible.sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name))

  // ------------------------------------------------------------- department
  const deptTotals = rollUp(closedInPeriod)
  const previous = input.previousRepairOrders
  const previousSold = previous
    ? previous.reduce((sum, ro) => sum + ro.sold, 0)
    : null
  const department: DepartmentTotals = {
    ...deptTotals,
    soldChangePercent:
      previousSold === null || previousSold === 0
        ? null
        : ((deptTotals.sold - previousSold) / previousSold) * 100,
  }

  // ------------------------------------------------------------------ drive
  const drive: DriveSnapshot = {
    total: today.length,
    unassigned: today.filter((a) => !a.advisorId).length,
    active: today.filter((a) => ACTIVE_STATUSES.has(a.status)).length,
    finished: today.filter((a) => FINISHED_STATUSES.has(a.status)).length,
    notArrived: today.filter(
      (a) => !ACTIVE_STATUSES.has(a.status) && !FINISHED_STATUSES.has(a.status),
    ).length,
  }

  // ---------------------------------------------------------------- backlog
  let overdue = 0
  let dueToday = 0
  let value = 0
  let worstOverdueDays = 0
  const byOwner = { ADVISOR: 0, BDC: 0 }
  for (const task of followUps) {
    value += task.estimatedValue
    byOwner[task.ownerRole] += 1

    /**
     * Overdue is measured in whole days, not against the current minute.
     *
     * A task due at 9am is not late at noon — it is today's work. Comparing
     * timestamps put every morning's list straight into the red, which is how
     * a backlog count stops meaning anything.
     */
    const lateBy = calendarDaysBetween(task.dueAt, asOf)
    if (lateBy > 0) {
      overdue += 1
      worstOverdueDays = Math.max(worstOverdueDays, lateBy)
    } else if (lateBy === 0) {
      dueToday += 1
    }
  }
  const backlog: BacklogSnapshot = {
    total: followUps.length,
    overdue,
    dueToday,
    value,
    byOwner,
    worstOverdueDays,
  }

  return {
    period,
    advisors: visible,
    department,
    drive,
    backlog,
    attention: buildAttention({ rows: visible, department, drive, backlog }),
  }
}

// ============================================================ attention

/**
 * What a manager should do something about today.
 *
 * Every item names a number and a next action. "Capture rate is down" is not
 * something anyone can act on before lunch; "four cars on the drive have no
 * advisor" is.
 */
export function buildAttention({
  rows,
  department,
  drive,
  backlog,
}: {
  rows: AdvisorRow[]
  department: DepartmentTotals
  drive: DriveSnapshot
  backlog: BacklogSnapshot
}): Attention[] {
  const out: Attention[] = []

  if (drive.unassigned > 0) {
    out.push({
      key: 'unassigned',
      tone: 'ALERT',
      headline: `${drive.unassigned} appointment${drive.unassigned === 1 ? '' : 's'} today with no advisor`,
      detail:
        'Nobody owns the prep sheet, so nobody is looking at the coverage before the customer walks up.',
    })
  }

  if (backlog.overdue > 0) {
    const bad = backlog.worstOverdueDays >= 30
    out.push({
      key: 'overdue-backlog',
      tone: bad ? 'ALERT' : 'WATCH',
      headline: `${backlog.overdue} follow-up${backlog.overdue === 1 ? '' : 's'} past due`,
      detail: bad
        ? `The oldest is ${backlog.worstOverdueDays} days late. Work the list top-down or snooze what is genuinely dead — an aging list stops being read.`
        : `Worst is ${backlog.worstOverdueDays} day${backlog.worstOverdueDays === 1 ? '' : 's'} late. Still recoverable today.`,
    })
  }

  /**
   * A lagging average, stated as a question rather than a verdict.
   *
   * Guarded by sample size on purpose: with three repair orders, one
   * transmission job is the entire difference between top and bottom of this
   * table, and a manager who runs a coaching conversation off that noise
   * teaches their team the board is nonsense.
   */
  const comparable = rows.filter((r) => r.rosClosed >= MIN_ROS_FOR_COMPARISON)
  if (comparable.length >= 2 && department.averagePerRo > 0) {
    const lagging = comparable
      .filter((r) => r.averagePerRo < department.averagePerRo * LAGGING_SHARE)
      .sort((a, b) => a.averagePerRo - b.averagePerRo)[0]
    if (lagging) {
      out.push({
        key: `lagging-${lagging.advisorId}`,
        tone: 'WATCH',
        headline: `${lagging.name} is averaging ${money(lagging.averagePerRo)} per RO`,
        detail: `The department is at ${money(department.averagePerRo)} across ${department.rosClosed} repair orders. Worth asking what they are seeing on the drive — this compares tickets, not effort.`,
      })
    }
  }

  if (department.covered > 0) {
    out.push({
      key: 'covered',
      tone: 'GOOD',
      headline: `${money(department.covered)} of work the customer did not pay for`,
      detail:
        'Warranty and contract work found before the ticket was written. Revenue for the store and a saving for the customer in the same line.',
    })
  }

  if (department.rosClosed === 0) {
    out.push({
      key: 'no-ros',
      tone: 'WATCH',
      headline: 'No closed repair orders in this window',
      detail:
        'Either the period has not started producing yet or nothing has been imported. The advisor table below will be empty until it does.',
    })
  }

  return out
}
