/**
 * Wear-rate prediction from inspection history.
 *
 * The MPI already records tread depth and pad thickness at every visit. Most
 * systems store the traffic-light colour and throw the number away. Two
 * measurements give a slope; a slope gives a predicted date. That is the
 * difference between selling tires when a customer notices a problem and
 * booking them before they do.
 */

export interface WearReading {
  /** Odometer when measured — the independent variable, not the date. */
  mileage: number
  value: number
  recordedAt: Date
}

export interface WearPrediction {
  currentValue: number
  /** Units consumed per 1,000 miles. Always reported positive. */
  ratePerThousandMiles: number
  milesUntilSellThreshold: number | null
  milesUntilCriticalThreshold: number | null
  /** Null when we cannot estimate how fast the customer drives. */
  daysUntilSellThreshold: number | null
  daysUntilCriticalThreshold: number | null
  /** Already at or past the safety limit. */
  isCritical: boolean
  /** At or past the point where it should be sold. */
  isAtSellThreshold: boolean
  /** Two readings is a line; three or more is a trend. */
  readingCount: number
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
}

/** Tread in 32nds: 4/32 is the sell point, 2/32 is the legal minimum. */
export const TIRE_THRESHOLDS = { sell: 4, critical: 2 } as const
/** Brake pad in millimetres. */
export const BRAKE_THRESHOLDS = { sell: 4, critical: 2 } as const

/**
 * Least-squares slope of value against mileage.
 *
 * Mileage rather than time, because a customer who drives 30k a year wears
 * tires three times faster than one who drives 10k, and the odometer already
 * captures that.
 */
function fitSlope(readings: WearReading[]): number | null {
  const n = readings.length
  if (n < 2) return null

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0
  for (const r of readings) {
    sumX += r.mileage
    sumY += r.value
    sumXY += r.mileage * r.value
    sumXX += r.mileage * r.mileage
  }
  const denominator = n * sumXX - sumX * sumX
  // Every reading taken at the same odometer — no information about rate.
  if (Math.abs(denominator) < 1e-9) return null

  return (n * sumXY - sumX * sumY) / denominator
}

export function predictWear(
  readings: WearReading[],
  thresholds: { sell: number; critical: number },
  avgMilesPerDay?: number | null,
): WearPrediction | null {
  if (readings.length === 0) return null

  const sorted = [...readings].sort((a, b) => a.mileage - b.mileage)
  const latest = sorted[sorted.length - 1]
  if (!latest) return null
  const currentValue = latest.value

  const slope = fitSlope(sorted)
  // A positive slope means the measurement grew with mileage, which is
  // physically impossible for wear — most likely a new part was fitted or the
  // tech mistyped. Report the current state without a bogus projection.
  const wearing = slope !== null && slope < 0
  const ratePerThousand = wearing ? Math.abs(slope) * 1000 : 0

  const milesUntil = (threshold: number): number | null => {
    if (currentValue <= threshold) return 0
    if (!wearing || ratePerThousand <= 0) return null
    return Math.round(((currentValue - threshold) / ratePerThousand) * 1000)
  }

  const milesToSell = milesUntil(thresholds.sell)
  const milesToCritical = milesUntil(thresholds.critical)

  const toDays = (miles: number | null): number | null => {
    if (miles === null) return null
    if (!avgMilesPerDay || avgMilesPerDay <= 0) return null
    return Math.round(miles / avgMilesPerDay)
  }

  let confidence: WearPrediction['confidence'] = 'LOW'
  if (sorted.length >= 3 && wearing) confidence = 'HIGH'
  else if (sorted.length === 2 && wearing) confidence = 'MEDIUM'

  return {
    currentValue,
    ratePerThousandMiles: Number(ratePerThousand.toFixed(3)),
    milesUntilSellThreshold: milesToSell,
    milesUntilCriticalThreshold: milesToCritical,
    daysUntilSellThreshold: toDays(milesToSell),
    daysUntilCriticalThreshold: toDays(milesToCritical),
    isCritical: currentValue <= thresholds.critical,
    isAtSellThreshold: currentValue <= thresholds.sell,
    readingCount: sorted.length,
    confidence,
  }
}

/**
 * Worst corner across a set of positions.
 *
 * A vehicle is sold tires on its worst corner, not its average — averaging
 * hides the one bald tire that is the actual safety issue and the actual sale.
 */
export function predictWorstCorner(
  byPosition: Map<string, WearReading[]>,
  thresholds: { sell: number; critical: number },
  avgMilesPerDay?: number | null,
): { position: string; prediction: WearPrediction } | null {
  let worst: { position: string; prediction: WearPrediction } | null = null

  for (const [position, readings] of byPosition) {
    const prediction = predictWear(readings, thresholds, avgMilesPerDay)
    if (!prediction) continue
    if (!worst || prediction.currentValue < worst.prediction.currentValue) {
      worst = { position, prediction }
    }
  }
  return worst
}
