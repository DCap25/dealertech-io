import { dayRulesFor, minuteOfDay, type DayRules } from './rules'

/**
 * The grid a day is booked on, and the one hard stop.
 *
 * Pure and I/O-free.
 */

export interface Slot {
  /** Local wall-clock start of the slot. */
  start: Date
  /** Exclusive. `start + slotMinutes`. */
  end: Date
  /** "8:00 AM" — what the picker shows and what a warning names. */
  label: string
}

/** Formatted in the server's local zone, so a label always names its own Date. */
function label(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/**
 * The slot grid for one day: store hours cut into slot-length pieces.
 *
 * Empty when the store is closed, which is the honest answer and is what the
 * booking form renders as "closed" rather than as an empty dropdown with no
 * explanation.
 *
 * A trailing part-slot is not offered. If a store closes at 17:45 on 30-minute
 * slots, the 17:30 slot would end after the doors do, and a booking nobody can
 * write up is worse than a quarter hour of unusable grid.
 */
export function slotsForDay(rules: DayRules[], day: Date): Slot[] {
  const dayRules = dayRulesFor(rules, day)
  if (!dayRules) return []
  if (dayRules.slotMinutes <= 0) return []

  const out: Slot[] = []
  for (
    let minute = dayRules.openMinute;
    minute + dayRules.slotMinutes <= dayRules.closeMinute;
    minute += dayRules.slotMinutes
  ) {
    const start = new Date(day)
    start.setHours(0, 0, 0, 0)
    start.setMinutes(minute)
    const end = new Date(start.getTime() + dayRules.slotMinutes * 60_000)
    out.push({ start, end, label: label(start) })
  }
  return out
}

/**
 * The one hard stop in the whole engine: outside the store's hours.
 *
 * Everything else warns (DRIVE_PLAN D3, decided — capacity warns, it does not
 * block), because a refusal teaches the booker to write the appointment down as
 * a phone note instead, and then the system has lost the booking *and* the
 * truth. Being closed is different in kind: nobody is in the building.
 *
 * Returns the sentence to show, or null when the time is inside hours.
 */
export function outsideHours(rules: DayRules[], when: Date): string | null {
  const dayRules = dayRulesFor(rules, when)
  const dayName = when.toLocaleDateString('en-US', { weekday: 'long' })
  if (!dayRules) return `The store is closed on ${dayName}.`

  const minute = minuteOfDay(when)
  const at = (m: number) => {
    const d = new Date(when)
    d.setHours(0, 0, 0, 0)
    d.setMinutes(m)
    return label(d)
  }

  if (minute < dayRules.openMinute) {
    return `${label(when)} is before the store opens on ${dayName} at ${at(dayRules.openMinute)}.`
  }
  if (minute >= dayRules.closeMinute) {
    return `${label(when)} is after the store closes on ${dayName} at ${at(dayRules.closeMinute)}.`
  }
  return null
}

/**
 * Who may book past that stop, and on what grounds.
 *
 * Two ways through, and they are not the same kind of permission:
 *
 *  - **A manager, for anything.** They own the drive and they are the person
 *    who will find the staffing for a 6:30 drop-off. `canManageStaff` is the
 *    predicate the roster and the nav already use; a third definition of
 *    "manager" would eventually disagree with them.
 *  - **Anybody, for a tow-in.** A tow-in is not a scheduling choice. The truck
 *    arrives when it arrives, and the row is a record of a car that is already
 *    in the lot — DRIVE_PLAN's own 7am example. Refusing it does not prevent
 *    the car being there; it only prevents the book from saying so, which is
 *    exactly the failure the warn-don't-block rule exists to avoid. This is
 *    widened from the plan's "manager override" on purpose: making an advisor
 *    hunt for a manager before recording a car that is physically present is
 *    the sort of friction that produces a sticky note instead of a row.
 *
 * `PICKUP_DELIVERY` deliberately does NOT get the same pass. That one *is* a
 * scheduled choice — somebody decides when the driver leaves — so it goes
 * through the manager like every other out-of-hours booking.
 */
export function mayOverrideHours(args: {
  isManager: boolean
  transportType: string
}): { allowed: boolean; because: string | null } {
  if (args.transportType === 'TOW_IN') {
    return { allowed: true, because: 'Tow-in — the car is already here.' }
  }
  if (args.isManager) return { allowed: true, because: 'Manager override.' }
  return { allowed: false, because: null }
}
