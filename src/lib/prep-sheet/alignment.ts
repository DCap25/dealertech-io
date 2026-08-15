/**
 * When to recommend a wheel alignment.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A MILEAGE INTERVAL
 * ---------------------------------------------------------------------------
 * Alignment is not a scheduled service. Nothing wears out on a schedule; the
 * angles move when a wheel hits something, or when a suspension component
 * wears. Manufacturers do not publish an alignment interval, and shops that
 * put one on a menu are inventing it.
 *
 * What alignment does leave is evidence, and the technician already writes it
 * down. A wheel dragged even slightly sideways scrubs rubber off one side of
 * the tread, so an axle whose two tyres have measurably different depths has
 * told you something a mileage counter never could.
 *
 * That is the trigger here: a real measured difference across an axle. It
 * means the recommendation comes with its own proof — "your left front is
 * 3/32" deeper than your right front" — which is both more honest and more
 * persuasive than a number pulled off a schedule.
 */

export interface AxleReading {
  position: string
  /** Thirty-seconds of an inch. */
  value: number
}

export interface AlignmentFinding {
  /** 'FRONT' | 'REAR' — which axle showed it. */
  axle: 'FRONT' | 'REAR'
  /** The gap across that axle, in 32nds. */
  spread: number
  left: number
  right: number
  /** Wording that carries its own evidence. */
  detail: string
}

/**
 * How much side-to-side difference counts.
 *
 * Two thirty-seconds. Below that is measurement noise — a technician's gauge,
 * where on the tread they happened to measure, normal variation between two
 * tyres of the same age. Recommending an alignment off 1/32" would be reading
 * tea leaves and would eventually be caught doing it.
 */
const SIGNIFICANT_SPREAD = 2

const FRONT = new Set(['LF', 'RF'])
const REAR = new Set(['LR', 'RR'])

function spreadFor(
  readings: AxleReading[],
  axle: 'FRONT' | 'REAR',
): AlignmentFinding | null {
  const wanted = axle === 'FRONT' ? FRONT : REAR
  const onAxle = readings.filter((r) => wanted.has(r.position))
  if (onAxle.length < 2) return null

  const left = onAxle.find((r) => r.position.startsWith('L'))
  const right = onAxle.find((r) => r.position.startsWith('R'))
  if (!left || !right) return null

  const spread = Math.abs(left.value - right.value)
  if (spread < SIGNIFICANT_SPREAD) return null

  const worn = left.value < right.value ? 'left' : 'right'
  const side = axle === 'FRONT' ? 'front' : 'rear'

  return {
    axle,
    spread,
    left: left.value,
    right: right.value,
    detail:
      `Your ${side} tyres differ by ${spread}/32" — ${left.value}/32" on the left, ` +
      `${right.value}/32" on the right. Uneven wear like that across one axle is what ` +
      `alignment being out looks like, and the ${worn} tyre is paying for it.`,
  }
}

/**
 * The worst axle showing uneven wear, if any.
 *
 * Front is preferred on a tie: it steers, it takes the kerb strikes, and it is
 * where alignment goes out first.
 */
export function detectAlignment(readings: AxleReading[]): AlignmentFinding | null {
  const front = spreadFor(readings, 'FRONT')
  const rear = spreadFor(readings, 'REAR')

  if (front && rear) return rear.spread > front.spread ? rear : front
  return front ?? rear
}
