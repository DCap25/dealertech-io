import { openThreads } from './threads'
import type { TimelineAppointment, TimelineInput, VisitCard } from './types'

/**
 * "Last visit, next visit, open threads (N)" — DRIVE_PLAN D6's ninety-second
 * version, the one the advisor actually reads in the lane.
 *
 * Pure, and built from the same `TimelineInput` and the same `openThreads` as
 * the full record page. The count on the prep sheet and the list on the
 * customer record are then the same number by construction rather than by
 * agreement between two files — which is the failure this shape exists to
 * prevent, because a card that says "2 open threads" over a page that lists
 * three is a card nobody trusts again.
 */

/** Statuses that mean the car was actually here. */
const ATTENDED = new Set(['ARRIVED', 'IN_SERVICE', 'READY', 'DELIVERED'])

/** Statuses that mean it is still going to happen. */
const UPCOMING = new Set(['SCHEDULED', 'CONFIRMED'])

function describe(a: TimelineAppointment): string {
  const parts = [a.transportType.replace(/_/g, ' ').toLowerCase()]
  if (a.advisorName) parts.push(a.advisorName)
  return parts.join(' · ')
}

export function buildVisitCard(input: TimelineInput, asOf: Date): VisitCard {
  /*
    Last visit is an appointment they turned up to, never a repair order.

    An RO is the paperwork and can be opened days after the car arrived or
    closed a week after it left; the appointment is when the person was
    standing here, which is what "last visit" means to somebody deciding how to
    greet them. A store whose ROs arrive by DMS pull with no appointment gets no
    last visit rather than a date that is off by a week — an absent fact reads
    as absent, a wrong one reads as true.
  */
  const attended = input.appointments
    .filter((a) => ATTENDED.has(a.status) && a.scheduledAt <= asOf)
    .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime())[0]

  /*
    Next visit excludes today's own appointment.

    This card renders on a prep sheet, and "next visit: today, 8:30am" is the
    appointment the advisor is currently standing in. Strictly after `asOf`,
    which on the drive is the moment the page rendered.
  */
  const upcoming = input.appointments
    .filter((a) => UPCOMING.has(a.status) && a.scheduledAt > asOf)
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0]

  return {
    lastVisit: attended
      ? { at: attended.scheduledAt, title: describe(attended), href: `/drive/${attended.id}` }
      : null,
    nextVisit: upcoming
      ? { at: upcoming.scheduledAt, title: describe(upcoming), href: `/drive/${upcoming.id}` }
      : null,
    threads: openThreads(input),
  }
}
