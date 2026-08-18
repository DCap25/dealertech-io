/**
 * When the car that was just sold should come back — DRIVE_PLAN D5.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FORM PUSHES A DATE AT ALL
 * ---------------------------------------------------------------------------
 * The workflow being encoded is "book the first service at delivery", and the
 * thing that kills it is not disagreement — it is friction. A salesperson with
 * a customer standing in front of them holding keys will not open a calendar
 * and work out what six months from Tuesday is. So the form arrives with a
 * date already in it and the booker moves it if they want to; the plan's own
 * instruction is to make the workflow *easier than not doing it*.
 *
 * The number comes from the store's `maintenance_schedules` when a row matches
 * the make, and from a stated default when none does. Both paths report which
 * they were, because "your Ford schedule says 7,500 miles" and "we assumed six
 * months" are different claims and only one of them is the dealership's.
 *
 * Pure and I/O-free. `store-rules.ts` does the reading.
 */

/**
 * The fallback, and it is a fallback rather than a recommendation.
 *
 * ~5,000 miles / 6 months is DRIVE_PLAN D5's own figure and the ordinary
 * modern oil-change interval. It applies when the store has no schedule row for
 * the make — which is every store on day one, since `maintenance_schedules`
 * ships empty — and the introduction page says so in words rather than
 * presenting a guess as the manufacturer's.
 */
export const FALLBACK_FIRST_SERVICE = { months: 6, miles: 5000 } as const

/**
 * Miles a car covers in a month, when a schedule quotes only mileage.
 *
 * 1,000 — twelve thousand a year, the figure every maintenance schedule and
 * every lease is written against. Used only to turn a miles-only interval into
 * a date, because a calendar is what the booking form needs and a schedule row
 * is allowed to answer in either unit. Once `vehicles.avg_miles_per_day` has
 * history on a car this could be that customer's own pace — but a car sold
 * this morning has no history at all, so a national average is the honest
 * input rather than a placeholder for one.
 */
const MILES_PER_MONTH = 1000

/** One row of `maintenance_schedules`, as far as this decision is concerned. */
export interface MaintenanceIntervalRow {
  make: string
  modelYearFrom: number | null
  modelYearTo: number | null
  intervalMiles: number | null
  intervalMonths: number | null
  description: string
}

export interface FirstServiceDefault {
  /** The day to prefill. Local midday, so no timezone can move it a day. */
  date: Date
  /** Whose number this is. `FALLBACK` means nobody's — say so on the form. */
  basis: 'SCHEDULE' | 'FALLBACK'
  months: number
  miles: number | null
  /** The matching schedule row's own words, when there was one. */
  description: string | null
}

/** Rows that apply to this vehicle, model-year bounds honoured when present. */
function applicable(
  schedules: MaintenanceIntervalRow[],
  make: string,
  modelYear: number,
): MaintenanceIntervalRow[] {
  const wanted = make.trim().toUpperCase()
  return schedules.filter((s) => {
    if (s.make.trim().toUpperCase() !== wanted) return false
    /*
      An open bound is "and everything after", not "no match". Reference data
      is written that way — a schedule introduced for 2021 cars carries a from
      and no to, because nobody knows when it ends.
    */
    if (s.modelYearFrom !== null && modelYear < s.modelYearFrom) return false
    if (s.modelYearTo !== null && modelYear > s.modelYearTo) return false
    return s.intervalMonths !== null || s.intervalMiles !== null
  })
}

/** A row's interval expressed in months, converting from miles if it has to. */
function monthsFor(row: MaintenanceIntervalRow): number {
  if (row.intervalMonths !== null) return row.intervalMonths
  return Math.max(1, Math.round((row.intervalMiles ?? 0) / MILES_PER_MONTH))
}

/**
 * The date the introduction form should open on.
 *
 * The **shortest** applicable interval wins, not the first row or the longest.
 * A make with several schedules has one for oil and one for, say, a 30,000
 * mile service, and the first service after delivery is the soonest of them —
 * booking the customer for the two-year item would be worse than booking
 * nothing, because it looks deliberate.
 *
 * `isOpen` rolls the date forward onto a day the store actually takes cars.
 * Six months from a Tuesday can land on a Sunday, and a form that opens on a
 * closed day shows an empty slot grid — which reads to a salesperson standing
 * with a customer as "the system is broken", not as "pick another day". A week
 * is the whole search: no store is shut for eight days running, and if one
 * somehow is, the date stands and the grid says the store is closed, which is
 * true.
 */
export function firstServiceDefault(input: {
  /** Usually the day of delivery, which is the day this is being booked. */
  from: Date
  make: string
  modelYear: number
  schedules: MaintenanceIntervalRow[]
  /** Whether the store takes cars on a given day. Omitted = every day. */
  isOpen?: (day: Date) => boolean
}): FirstServiceDefault {
  const rows = applicable(input.schedules, input.make, input.modelYear)

  const best = rows.length > 0
    ? rows.reduce((a, b) => (monthsFor(b) < monthsFor(a) ? b : a))
    : null

  const months = best ? monthsFor(best) : FALLBACK_FIRST_SERVICE.months
  const miles = best ? best.intervalMiles : FALLBACK_FIRST_SERVICE.miles

  /*
    Midday rather than midnight. Every date on the booking side is read back
    through `new Date('YYYY-MM-DDT12:00:00')` for exactly this reason — a
    midnight timestamp is one hour of drift away from being the previous day,
    and "the appointment is on the wrong day" is the worst possible bug in a
    scheduler.
  */
  const date = new Date(input.from)
  date.setHours(12, 0, 0, 0)
  date.setMonth(date.getMonth() + months)

  const isOpen = input.isOpen
  if (isOpen) {
    for (let i = 0; i < 7 && !isOpen(date); i++) date.setDate(date.getDate() + 1)
  }

  return {
    date,
    basis: best ? 'SCHEDULE' : 'FALLBACK',
    months,
    miles,
    description: best?.description ?? null,
  }
}
