import { differenceInCalendarDays } from 'date-fns'
import type { PrepSheet } from './types'

/**
 * The red carpet, as a small pure function — DRIVE_PLAN D5.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------
 * A customer whose first service was booked at delivery is the one visit where
 * the advisor has an unfair advantage and usually does not know it: somebody
 * already introduced them by name, the car was bought here weeks ago, and F&I
 * may have sold coverage with it. An advisor who greets them like any other
 * 8:30 drop-off wastes the whole point of the handshake.
 *
 * So the drive says the three things worth saying and then gets out of the way.
 * Deliberately **not** a redesign of the prep sheet and deliberately not a
 * second coverage summary: the coverage stack already renders every contract on
 * the car and is the authority on who pays, so this points at it in a sentence
 * rather than restating it in a panel that could disagree.
 *
 * Pure and I/O-free; the fields it reads are threaded from the appointment row
 * through the DMS bundle and mapper like `advisorId` and `status` before them.
 */

export interface FirstServiceCue {
  /** "First service" — the label, so callers do not each invent one. */
  label: string
  /** "Sold by Ana Reyes · introduced to Marcus Webb", or half of it. */
  attribution: string | null
  /**
   * The short sentences worth reading in the lane. Never more than three, and
   * empty is a real answer — a cue with a label and nothing else is still worth
   * showing, because the label is the part that changes the greeting.
   */
  notes: string[]
}

/** Roughly a month, for saying "sold last month" without pretending to precision. */
const DAYS_PER_MONTH = 30

/**
 * Build the cue, or null when this is an ordinary visit.
 *
 * `asOf` is passed rather than read from a clock so the sentence a test asserts
 * is the sentence the drive prints, and so the demo store's fixed date produces
 * a stable screenshot like everything else.
 */
export function firstServiceCue(sheet: PrepSheet, asOf: Date): FirstServiceCue | null {
  const appointment = sheet.appointment
  if (appointment?.visitContext !== 'FIRST_SERVICE') return null

  const attribution = [
    appointment.soldByName ? `Sold by ${appointment.soldByName}` : null,
    appointment.introducedAdvisorName
      ? `introduced to ${appointment.introducedAdvisorName}`
      : null,
  ].filter(Boolean).join(' · ') || null

  const notes: string[] = []

  /*
    Have they ever been in for service before?

    `visitCount` counts closed repair orders, so zero means this really is the
    first time the service department meets them — the sentence that changes how
    the greeting starts. A repeat customer who bought a second car gets the
    honest version instead, which is a different and also useful fact.
  */
  notes.push(
    sheet.customer.visitCount === 0
      ? 'New to the service drive — they have never been in.'
      : `Already a customer here: ${sheet.customer.visitCount} previous visit${sheet.customer.visitCount === 1 ? '' : 's'}.`,
  )

  /*
    How long ago the car was delivered.

    From `inServiceDate`, which for a car sold new IS the delivery date — it is
    the date every warranty clock runs from, and the reason it is on the vehicle
    at all. Skipped rather than guessed when the source system does not carry
    one, and skipped when it is in the future or absurdly old, which is what a
    placeholder date looks like.
  */
  const delivered = sheet.vehicle.inServiceDate
  if (delivered) {
    const days = differenceInCalendarDays(asOf, delivered)
    if (days >= 0 && days <= 400) {
      notes.push(
        days <= 45
          ? `Delivered ${days <= 1 ? 'this week' : `${days} days ago`}.`
          : `Delivered about ${Math.round(days / DAYS_PER_MONTH)} months ago.`,
      )
    }
  }

  /*
    What F&I sold with the car — pointed at, never restated.

    The coverage engine already arbitrates every contract on this vehicle and
    the coverage stack renders them, so duplicating the products here would
    create a second answer to "what do they own" that can drift from the first.
    One sentence with a count is enough to stop an advisor selling work the
    customer has already paid for, which is the whole failure this catches.
  */
  const active = sheet.contracts.filter((c) => c.status === 'ACTIVE').length
  if (active > 0) {
    notes.push(
      `${active} coverage product${active === 1 ? '' : 's'} sold with the car — see the coverage panel before quoting anything.`,
    )
  }

  return { label: 'First service', attribution, notes: notes.slice(0, 3) }
}
