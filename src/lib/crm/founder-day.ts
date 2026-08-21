/**
 * What "today" means to the person reading the morning read.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CONSOLE NEEDS A TIMEZONE AT ALL, HAVING AVOIDED ONE EVERYWHERE ELSE
 * ---------------------------------------------------------------------------
 * Almost nothing in this console has a time of day. "3d ago" and "stale" read
 * the same from anywhere, so every other surface stores instants and formats
 * relatively, and the question never comes up.
 *
 * A walkthrough is the exception. It is booked for two o'clock, it is the most
 * time-bound item on the page, and "Walkthroughs today" is a claim about a
 * calendar day rather than about an instant. Asked in UTC — which is what
 * `walkthrough_at::date` means on Netlify — a demo at seven in the evening in
 * Texas falls on tomorrow's date, so the one tile with a deadline attached
 * would announce it the morning after. Migration 0035's own comment says the
 * founder's timezone is the only one that matters yet; this is that sentence
 * made executable.
 *
 * ---------------------------------------------------------------------------
 * ONE CONSTANT, AND IT MOVES WHEN DAN DOES
 * ---------------------------------------------------------------------------
 * There is no per-user timezone and there should not be until there is a
 * second person selling — a preference column read by one row is a schema
 * change pretending to be a feature. When Dan moves, this constant changes and
 * nothing else does.
 *
 * Pure and I/O-free apart from `Intl`, which is data rather than a clock. The
 * instant is always a parameter, so a test can sit on either side of a
 * daylight-saving boundary.
 */

/** Where the person reading this console is sitting. Change it when that changes. */
export const FOUNDER_TIMEZONE = 'America/Chicago'

const PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: FOUNDER_TIMEZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/** The wall clock in the founder's timezone at a given instant. */
function wallClock(at: Date): WallClock {
  const parts = PARTS.formatToParts(at)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0)

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // Some runtimes render midnight as hour 24 under hour12: false. Left
    // unhandled it makes the start of a day land at the end of the previous
    // one, which is the sort of bug that only appears on two engines.
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  }
}

/**
 * The calendar day, as `YYYY-MM-DD`, in the founder's timezone.
 *
 * A string rather than a Date because that is what the comparison actually is:
 * two instants are "the same day" when their local dates match, and comparing
 * them as strings cannot be quietly wrong about an offset the way subtracting
 * milliseconds can.
 */
export function founderDayKey(at: Date): string {
  const { year, month, day } = wallClock(at)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Do these two instants fall on the same day where the reader is? */
export function isOnFounderDay(at: Date, asOf: Date): boolean {
  return founderDayKey(at) === founderDayKey(asOf)
}

/**
 * Midnight, locally, on the day containing `asOf`.
 *
 * The lower bound of the query behind "Walkthroughs today": a demo at nine
 * this morning has to still be on the list at eleven, so the window starts at
 * the beginning of the day rather than at the current instant.
 *
 * Two passes, because the offset at midnight is not always the offset now. On
 * the two days a year the clocks move, a single-pass conversion lands an hour
 * out — which on the spring-forward morning would put the boundary after a
 * genuinely early appointment and drop it from the list.
 */
export function startOfFounderDay(asOf: Date): Date {
  const offsetAt = (instant: Date): number => {
    const c = wallClock(instant)
    return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - instant.getTime()
  }

  const first = offsetAt(asOf)
  const local = new Date(asOf.getTime() + first)
  const midnightAsUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())

  const guess = midnightAsUtc - first
  const second = offsetAt(new Date(guess))
  return new Date(second === first ? guess : midnightAsUtc - second)
}
