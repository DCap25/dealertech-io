import {
  BRAKE_THRESHOLDS, TIRE_THRESHOLDS, predictWear,
  type WearPrediction, type WearReading,
} from './wear'
import type { InspectionSnapshot } from './types'

/**
 * Presentation layer for the wear engine.
 *
 * Pure and I/O-free. It never re-fits a line or re-derives a rate — every
 * number here comes from `predictWear`. Its only job is turning that output
 * into coordinates and sentences, so that what an advisor shows a customer is
 * provably the same projection the opportunity was ranked on.
 */

export type WearKind = 'TIRES' | 'BRAKES'

/** Brakes are measured for the axle, not the corner, in this MPI. */
export const AGGREGATE_POSITION = 'ALL'

const POSITION_LABEL: Record<string, string> = {
  LF: 'Left front',
  RF: 'Right front',
  LR: 'Left rear',
  RR: 'Right rear',
  SPARE: 'Spare',
  [AGGREGATE_POSITION]: 'Measured',
}

/** Draw order, so corners always appear in the same place on the legend. */
const POSITION_ORDER = ['LF', 'RF', 'LR', 'RR', 'SPARE', AGGREGATE_POSITION]

export interface WearSeries {
  key: string
  position: string
  label: string
  readings: WearReading[]
  prediction: WearPrediction | null
  /** The corner that drove the recommendation. */
  isWorst: boolean
}

export interface WearScale {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

export interface WearViewModel {
  kind: WearKind
  /** '/32"' or 'mm'. */
  unit: string
  unitLong: string
  thresholds: { sell: number; critical: number }
  series: WearSeries[]
  worst: WearSeries | null
  scale: WearScale
  /** Odometer at the latest measurement — where the projection starts. */
  latestMileage: number
  avgMilesPerDay: number | null
}

export const WEAR_CONFIG: Record<WearKind, {
  componentGroupKey: string
  thresholds: { sell: number; critical: number }
  unit: string
  unitLong: string
  title: string
}> = {
  TIRES: {
    componentGroupKey: 'TIRES',
    thresholds: TIRE_THRESHOLDS,
    unit: '/32"',
    unitLong: 'thirty-seconds of an inch',
    title: 'Tread depth',
  },
  BRAKES: {
    componentGroupKey: 'BRAKE_PADS_SHOES',
    thresholds: BRAKE_THRESHOLDS,
    unit: 'mm',
    unitLong: 'millimetres',
    title: 'Brake pad thickness',
  },
}

/**
 * How far past the last measurement the chart looks.
 *
 * Bounded so a nearly-new tire wearing very slowly does not produce an x-axis
 * running to 200,000 miles and squash every real reading into the left edge.
 */
const MAX_PROJECTION_MILES = 40_000
const MIN_PROJECTION_MILES = 3_000

function groupReadings(
  history: InspectionSnapshot[],
  componentGroupKey: string,
): Map<string, WearReading[]> {
  const byPosition = new Map<string, WearReading[]>()
  for (const inspection of history) {
    for (const item of inspection.items) {
      if (item.value === null) continue
      if (item.componentGroupKey !== componentGroupKey) continue
      const position = item.position ?? AGGREGATE_POSITION
      const reading: WearReading = {
        mileage: inspection.mileage,
        value: item.value,
        recordedAt: inspection.recordedAt,
      }
      const existing = byPosition.get(position)
      if (existing) existing.push(reading)
      else byPosition.set(position, [reading])
    }
  }
  return byPosition
}

/**
 * Value the engine's projection implies at a given odometer.
 *
 * Anchored on the latest reading rather than on a re-fitted intercept, because
 * that is exactly what `predictWear` does when it computes miles-to-threshold.
 * Drawing any other line would show a customer a picture that disagrees with
 * the number beside it.
 */
export function projectedValueAt(
  prediction: WearPrediction,
  latestMileage: number,
  mileage: number,
): number {
  const perMile = prediction.ratePerThousandMiles / 1000
  return prediction.currentValue - perMile * (mileage - latestMileage)
}

/** Odometer at which the projection crosses a threshold. Null when not wearing. */
export function mileageAtThreshold(
  prediction: WearPrediction,
  latestMileage: number,
  threshold: number,
): number | null {
  if (prediction.ratePerThousandMiles <= 0) return null
  if (prediction.currentValue <= threshold) return latestMileage
  const miles = ((prediction.currentValue - threshold) / prediction.ratePerThousandMiles) * 1000
  return Math.round(latestMileage + miles)
}

export function buildWearView(
  kind: WearKind,
  history: InspectionSnapshot[],
  avgMilesPerDay: number | null,
): WearViewModel | null {
  const config = WEAR_CONFIG[kind]
  const byPosition = groupReadings(history, config.componentGroupKey)
  if (byPosition.size === 0) return null

  const series: WearSeries[] = [...byPosition.entries()]
    .map(([position, readings]) => {
      const sorted = [...readings].sort((a, b) => a.mileage - b.mileage)
      return {
        key: `${kind}:${position}`,
        position,
        label: POSITION_LABEL[position] ?? position,
        readings: sorted,
        prediction: predictWear(sorted, config.thresholds, avgMilesPerDay),
        isWorst: false,
      }
    })
    .sort((a, b) => POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position))

  /**
   * Worst corner is lowest current value, matching `predictWorstCorner`. A
   * vehicle is sold tires on its worst corner, not its average.
   */
  let worst: WearSeries | null = null
  for (const s of series) {
    if (!s.prediction) continue
    if (!worst?.prediction || s.prediction.currentValue < worst.prediction.currentValue) {
      worst = s
    }
  }
  if (worst) worst.isWorst = true

  const allReadings = series.flatMap((s) => s.readings)
  const latestMileage = Math.max(...allReadings.map((r) => r.mileage))
  const firstMileage = Math.min(...allReadings.map((r) => r.mileage))
  const maxValue = Math.max(...allReadings.map((r) => r.value))

  // Extend the axis to wherever the worst corner reaches the legal minimum, so
  // the whole story — measured past and projected future — fits in one frame.
  const criticalMileage =
    worst?.prediction
      ? mileageAtThreshold(worst.prediction, latestMileage, config.thresholds.critical)
      : null

  const projectedEnd = criticalMileage ?? latestMileage + MIN_PROJECTION_MILES
  const xMax = Math.min(
    Math.max(projectedEnd, latestMileage + MIN_PROJECTION_MILES),
    latestMileage + MAX_PROJECTION_MILES,
  )

  return {
    kind,
    unit: config.unit,
    unitLong: config.unitLong,
    thresholds: config.thresholds,
    series,
    worst,
    scale: {
      // A little headroom left of the first reading so points aren't clipped.
      xMin: firstMileage - Math.max(500, (xMax - firstMileage) * 0.04),
      xMax,
      yMin: 0,
      yMax: Math.ceil(maxValue + 1),
    },
    latestMileage,
    avgMilesPerDay,
  }
}

// ===========================================================================
// Chart space: 0–100 on both axes, y inverted so a high measurement sits high.

export function scaleX(scale: WearScale, mileage: number): number {
  const span = scale.xMax - scale.xMin
  if (span <= 0) return 0
  return ((mileage - scale.xMin) / span) * 100
}

export function scaleY(scale: WearScale, value: number): number {
  const span = scale.yMax - scale.yMin
  if (span <= 0) return 100
  return 100 - ((value - scale.yMin) / span) * 100
}

export function seriesPolyline(scale: WearScale, readings: WearReading[]): string {
  return readings
    .map((r) => `${scaleX(scale, r.mileage).toFixed(2)},${scaleY(scale, r.value).toFixed(2)}`)
    .join(' ')
}

/** The dashed forward projection, from the latest reading to the axis edge. */
export function projectionPolyline(
  scale: WearScale,
  prediction: WearPrediction,
  latestMileage: number,
): string | null {
  if (prediction.ratePerThousandMiles <= 0) return null
  const endValue = projectedValueAt(prediction, latestMileage, scale.xMax)
  return [
    `${scaleX(scale, latestMileage).toFixed(2)},${scaleY(scale, prediction.currentValue).toFixed(2)}`,
    `${scaleX(scale, scale.xMax).toFixed(2)},${scaleY(scale, Math.max(0, endValue)).toFixed(2)}`,
  ].join(' ')
}

// ===========================================================================
// Words

export function formatMiles(miles: number): string {
  return `${Math.round(miles).toLocaleString()} mi`
}

/**
 * When the threshold arrives in calendar terms.
 *
 * Rounded to the month beyond eight weeks: "in about 7 months" is honest about
 * the precision of a two-point fit in a way that "on 14 March 2027" is not.
 */
export function formatHorizon(days: number | null): string | null {
  if (days === null) return null
  if (days <= 0) return 'now'
  if (days < 14) return `about ${days} days`
  if (days < 60) return `about ${Math.round(days / 7)} weeks`
  const months = Math.round(days / 30.44)
  if (months < 24) return `about ${months} month${months === 1 ? '' : 's'}`
  return `about ${Math.round(months / 12)} years`
}

export function projectedDate(from: Date, days: number | null): Date | null {
  if (days === null) return null
  return new Date(from.getTime() + days * 86_400_000)
}

export type WearTone = 'CRITICAL' | 'DUE' | 'WATCH' | 'HEALTHY'

export function toneFor(prediction: WearPrediction | null): WearTone {
  if (!prediction) return 'HEALTHY'
  if (prediction.isCritical) return 'CRITICAL'
  if (prediction.isAtSellThreshold) return 'DUE'
  if (
    prediction.milesUntilSellThreshold !== null &&
    prediction.milesUntilSellThreshold <= 10_000
  ) {
    return 'WATCH'
  }
  return 'HEALTHY'
}

/**
 * Plain-English statement of how good this projection actually is.
 *
 * Shown to the advisor on every chart, because a projection from two readings
 * and one from six look identical once they are lines — and one of them is a
 * guess. An advisor who repeats a guess as fact loses the customer the first
 * time it is wrong.
 */
export function confidenceNote(prediction: WearPrediction | null): string {
  if (!prediction) return 'No measurements on file for this component.'

  if (prediction.ratePerThousandMiles <= 0) {
    return prediction.readingCount < 2
      ? 'Only one measurement on file, so there is no trend to project yet. This is a current reading, not a forecast.'
      : 'The measurements did not decrease, which usually means this was replaced between visits. No projection until the next reading establishes a fresh trend.'
  }

  switch (prediction.confidence) {
    case 'HIGH':
      return `Based on ${prediction.readingCount} measurements — a trend, not a guess.`
    case 'MEDIUM':
      return 'Based on 2 measurements. Enough for a straight line, but the next visit will sharpen it.'
    default:
      return 'Limited measurement history — treat this as an estimate.'
  }
}
