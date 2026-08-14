import type { InspectionSnapshot } from '@/lib/prep-sheet'
import type { Explainer, Reading } from './types'

/**
 * Pull this vehicle's own measurement out of the inspection, if the technician
 * recorded one for the group being explained.
 *
 * This is the difference between a diagram and an argument. "Pads wear out"
 * is a fact about cars; "your left front is at 3mm and the scale runs to 2"
 * is a fact about the car they drove in.
 */

/** Units the inspection stores, mapped to what a scale expects. */
const UNIT_ALIASES: Record<string, string> = {
  MILLIMETERS: 'mm',
  MILLIMETRES: 'mm',
  THIRTY_SECONDS: '32nds',
}

function normaliseUnit(unit: string | null): string | null {
  if (!unit) return null
  return UNIT_ALIASES[unit] ?? unit
}

/**
 * The most recent inspection in a history of unknown order.
 *
 * Taking the last element of the array looked right and was not: nothing in
 * the adapter contract promises an order, and an older inspection produced a
 * reassuring 5/32" for a customer whose tyres were actually measured at 2/32"
 * that morning. The wear engine never noticed because it fits a regression
 * across every point and does not care which one is last.
 *
 * Mileage breaks a tie on date, because two inspections stamped the same day
 * are the same visit and the higher odometer is the later one.
 */
export function latestInspection(
  history: InspectionSnapshot[] | null | undefined,
): InspectionSnapshot | null {
  if (!history || history.length === 0) return null
  return history.reduce((latest, candidate) => {
    const byDate = candidate.recordedAt.getTime() - latest.recordedAt.getTime()
    if (byDate > 0) return candidate
    if (byDate === 0 && candidate.mileage > latest.mileage) return candidate
    return latest
  })
}

/**
 * The reading that matters is the worst one, from the newest inspection.
 *
 * Averaging four corners hides the problem: two good tyres and two at the
 * limit average out to something reassuring, and it is the pair at the limit
 * that stops the car.
 *
 * Takes the whole history rather than one snapshot so no caller has to know
 * how it is ordered.
 */
export function worstReadingFor(
  explainer: Explainer,
  history: InspectionSnapshot[] | null | undefined,
): Reading | null {
  const inspection = latestInspection(history)
  if (!inspection || !explainer.scale) return null

  const candidates = inspection.items.filter(
    (i) =>
      i.componentGroupKey === explainer.key &&
      i.value !== null &&
      Number.isFinite(i.value) &&
      normaliseUnit(i.unit) === explainer.scale!.unit,
  )
  if (candidates.length === 0) return null

  let worst = candidates[0]!
  for (const item of candidates) {
    // Every scale in the library counts down toward its limit.
    if ((item.value ?? 0) < (worst.value ?? 0)) worst = item
  }

  return {
    value: worst.value!,
    unit: explainer.scale.unit,
    position: worst.position,
  }
}

export type ReadingStatus = 'HEALTHY' | 'PRESENT' | 'AT_LIMIT'

/**
 * Where a reading sits against the scale.
 *
 * Deliberately three states and not a percentage. A customer reads "past the
 * point makers recommend replacing" and knows what to do with it; 34% means
 * nothing without knowing 34% of what.
 */
export function statusOf(explainer: Explainer, reading: Reading | null): ReadingStatus | null {
  if (!reading || !explainer.scale) return null
  if (reading.value <= explainer.scale.limit) return 'AT_LIMIT'
  if (reading.value <= explainer.scale.present) return 'PRESENT'
  return 'HEALTHY'
}

/** How much of the part's usable life is left, 0–1, for plotting only. */
export function remainingFraction(explainer: Explainer, reading: Reading | null): number | null {
  if (!reading || !explainer.scale) return null
  const { fresh, limit } = explainer.scale
  const span = fresh - limit
  if (span <= 0) return null
  return Math.max(0, Math.min(1, (reading.value - limit) / span))
}

/** "3mm" / "4/32\"" — how the number is written on a repair order. */
export function formatReading(reading: Reading): string {
  return reading.unit === '32nds' ? `${reading.value}/32"` : `${reading.value}${reading.unit}`
}
