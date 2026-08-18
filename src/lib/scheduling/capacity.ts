import { dayRulesFor, type DayRules } from './rules'
import type { Slot } from './slots'

/**
 * How full a book is, said in sentences.
 *
 * ---------------------------------------------------------------------------
 * WHY SENTENCES AND NOT BOOLEANS
 * ---------------------------------------------------------------------------
 * The menu builder's `menuWarnings` set the precedent and DRIVE_PLAN D3 makes
 * it the decision: capacity warns, it never blocks. The person booking may know
 * exactly why a fifth write-up at 8:00 is fine — the fifth is a five-minute
 * recall the tech is already staged for — and a hard refusal does not stop them
 * booking it, it stops them booking it *here*. So the output is what a person
 * needs to make that call: who, how many, out of how many, and when.
 *
 * DRIVE_PLAN §9 **Q3 is open** — whether any store needs over-booking to hard
 * block. It is deliberately NOT built: there is no per-store hard-block flag on
 * `scheduling_rules` and nothing in this file returns a refusal. If a pilot
 * store demands one it is a column and a branch, not a redesign.
 *
 * Pure and I/O-free.
 */

/**
 * The narrow view of an appointment this file needs.
 *
 * Narrow on purpose: `WeekCard` (src/lib/drive/week.ts) already satisfies it
 * structurally, so the week's card model feeds these functions unchanged and
 * without being bent into a shape it does not want. A caller reading rows
 * straight out of the database can build it in one `map`.
 */
export interface ScheduledAppointment {
  appointmentId: string
  advisorId: string | null
  scheduledAt: Date
  isWaiter: boolean
}

/** One advisor as the drive knows them on a given day. */
export interface AdvisorOnDuty {
  advisorId: string
  name: string
  /**
   * Whether they are working that day.
   *
   * Nothing in the schema records a shift — there is no roster calendar — so
   * every caller in P2 passes `true`, and D4's "skip anyone who is off" is
   * seam rather than behaviour. Kept in the input because the alternative is
   * discovering later that off-shift has to thread through four signatures.
   */
  working: boolean
}

/** Which slot a moment falls in, or -1 when it falls outside the grid. */
function slotIndexOf(slots: Slot[], when: Date): number {
  const t = when.getTime()
  return slots.findIndex((s) => t >= s.start.getTime() && t < s.end.getTime())
}

export interface BookLoad {
  /** Slot start (epoch ms) → appointments in that slot. Only non-empty slots. */
  perSlot: Map<number, number>
  /** The whole day, including anything outside the slot grid. */
  dayCount: number
}

/**
 * One advisor's load across a day's slots.
 *
 * `advisorId: null` reads the unassigned pool, which is a book like any other —
 * it is what the drive will be claiming from at write-up, and a pool nobody
 * counted is how a "quiet" Tuesday turns out to hold nine cars.
 */
export function bookLoad(
  slots: Slot[],
  appointments: ScheduledAppointment[],
  advisorId: string | null,
): BookLoad {
  const perSlot = new Map<number, number>()
  let dayCount = 0

  for (const a of appointments) {
    if ((a.advisorId ?? null) !== advisorId) continue
    dayCount += 1
    const index = slotIndexOf(slots, a.scheduledAt)
    if (index < 0) continue
    const key = slots[index]!.start.getTime()
    perSlot.set(key, (perSlot.get(key) ?? 0) + 1)
  }

  return { perSlot, dayCount }
}

/** Waiters per slot across every book — the lounge, not any one advisor's day. */
export function waiterLoad(
  slots: Slot[],
  appointments: ScheduledAppointment[],
): Map<number, number> {
  const perSlot = new Map<number, number>()
  for (const a of appointments) {
    if (!a.isWaiter) continue
    const index = slotIndexOf(slots, a.scheduledAt)
    if (index < 0) continue
    const key = slots[index]!.start.getTime()
    perSlot.set(key, (perSlot.get(key) ?? 0) + 1)
  }
  return perSlot
}

/** Appointments per advisor for a day. The weight balanced assignment uses. */
export function countByAdvisor(appointments: ScheduledAppointment[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const a of appointments) {
    if (!a.advisorId) continue
    out.set(a.advisorId, (out.get(a.advisorId) ?? 0) + 1)
  }
  return out
}

export interface CapacityInput {
  rules: DayRules[]
  slots: Slot[]
  /** The slot this booking is going into. */
  slotStart: Date
  /** Who it is being booked to, or null for the unassigned pool. */
  advisorId: string | null
  advisors: AdvisorOnDuty[]
  /** Everything already on that day's book, every advisor and the pool. */
  dayAppointments: ScheduledAppointment[]
  isWaiter: boolean
  /**
   * Ignored when counting — set when re-checking an appointment that is already
   * on the book, so it does not warn about competing with itself.
   */
  excludeAppointmentId?: string | null
}

/**
 * What the booker should be told before they press the button.
 *
 * Empty means nothing worth saying. Never a refusal: every sentence here is
 * information, and the form renders all of them and books anyway.
 */
export function capacityWarnings(input: CapacityInput): string[] {
  const rules = dayRulesFor(input.rules, input.slotStart)
  if (!rules) return []

  const existing = input.dayAppointments.filter(
    (a) => a.appointmentId !== (input.excludeAppointmentId ?? ''),
  )
  const slotKey = input.slotStart.getTime()
  const slotLabel = input.slots.find((s) => s.start.getTime() === slotKey)?.label
    ?? input.slotStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const dayLabel = input.slotStart.toLocaleDateString('en-US', { weekday: 'long' })

  const out: string[] = []

  if (input.advisorId) {
    const advisor = input.advisors.find((a) => a.advisorId === input.advisorId)
    const name = advisor?.name ?? 'That advisor'

    /*
      Off-shift is first because it changes the decision rather than colouring
      it — the other warnings are about a busy day, this one is about a day the
      customer would arrive to nobody. Never a silent reassignment (D4): the
      booker sees it and picks another day or another advisor.
    */
    if (advisor && !advisor.working) {
      out.push(`${name} is not on the schedule for ${dayLabel} — pick another day or another advisor.`)
    }

    const load = bookLoad(input.slots, existing, input.advisorId)
    const inSlot = load.perSlot.get(slotKey) ?? 0

    if (inSlot + 1 > rules.maxPerAdvisorSlot) {
      out.push(
        `${name} is at ${inSlot} of ${rules.maxPerAdvisorSlot} write-ups at ${slotLabel} — this would make ${inSlot + 1}.`,
      )
    }
    if (load.dayCount + 1 > rules.maxPerAdvisorDay) {
      out.push(
        `${name} is at ${load.dayCount} of ${rules.maxPerAdvisorDay} write-ups for ${dayLabel} — this would make ${load.dayCount + 1}.`,
      )
    }
  }

  if (input.isWaiter) {
    const waiters = waiterLoad(input.slots, existing).get(slotKey) ?? 0
    if (waiters + 1 > rules.maxWaitersPerSlot) {
      out.push(
        `${waiters} of ${rules.maxWaitersPerSlot} waiters are already booked for ${slotLabel} — the lounge fills up whoever's book they sit in.`,
      )
    }
  }

  return out
}
