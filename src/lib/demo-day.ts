/**
 * The demo day.
 *
 * ---------------------------------------------------------------------------
 * CONVENTION
 * ---------------------------------------------------------------------------
 * The seeded dealership lives on a fixed date rather than on the wall clock, so
 * a screenshot taken today still matches the app next month and a test suite
 * does not fail at midnight. Everything — appointments, repair-order history,
 * inspections, cadence tasks — is generated relative to this one constant.
 *
 * All of it comes from here. It used to be hardcoded in ten files at three
 * different times of day, which is how the drive and the scorecard ended up
 * disagreeing about what "this week" meant.
 *
 * To move the demo forward: change DEMO_DAY, then re-run
 *
 *   npm run db:seed && npm run cadence:run
 *
 * To run against real time instead, set DEMO_DAY_ISO to an empty string in the
 * environment — every surface will follow the clock.
 */

const CONFIGURED = process.env.DEMO_DAY_ISO ?? process.env.NEXT_PUBLIC_DEMO_DAY_ISO

/** Midday, so a timezone shift either way stays on the same calendar date. */
const DEFAULT_DEMO_DAY = '2026-08-12T12:00:00.000Z'

/**
 * The moment the product treats as "now".
 *
 * A fresh Date each call — callers mutate what they are given (setUTCHours on
 * an appointment slot, for one), and a shared instance would drift.
 */
export function demoNow(): Date {
  if (CONFIGURED === '') return new Date()
  const raw = CONFIGURED || DEFAULT_DEMO_DAY
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? new Date(DEFAULT_DEMO_DAY) : parsed
}

/** Midnight at the start of the demo day, for range queries. */
export function demoDayStart(): Date {
  const d = demoNow()
  d.setHours(0, 0, 0, 0)
  return d
}

/** The last instant of the demo day — what a worklist means by "due today". */
export function demoDayEnd(): Date {
  const d = demoNow()
  d.setHours(23, 59, 59, 999)
  return d
}
