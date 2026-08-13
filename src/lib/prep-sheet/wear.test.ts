import { describe, it, expect } from 'vitest'
import { predictWear, predictWorstCorner, TIRE_THRESHOLDS, BRAKE_THRESHOLDS, type WearReading } from './wear'

const reading = (mileage: number, value: number): WearReading => ({
  mileage,
  value,
  recordedAt: new Date(2026, 0, 1),
})

describe('wear prediction', () => {
  it('projects a tread depth forward from three visits', () => {
    // 10/32 at 20k, 8/32 at 30k, 6/32 at 40k — 2/32 per 10k miles.
    const p = predictWear(
      [reading(20_000, 10), reading(30_000, 8), reading(40_000, 6)],
      TIRE_THRESHOLDS,
      40,
    )
    expect(p?.ratePerThousandMiles).toBeCloseTo(0.2, 2)
    // 6/32 now, sell at 4/32 → 2/32 to go at 0.2 per 1000 = 10,000 miles.
    expect(p?.milesUntilSellThreshold).toBe(10_000)
    expect(p?.milesUntilCriticalThreshold).toBe(20_000)
    expect(p?.confidence).toBe('HIGH')
  })

  it('converts miles to days using how fast the customer actually drives', () => {
    const fast = predictWear([reading(20_000, 10), reading(40_000, 6)], TIRE_THRESHOLDS, 100)
    const slow = predictWear([reading(20_000, 10), reading(40_000, 6)], TIRE_THRESHOLDS, 20)
    // Same wear rate, same tread — but one customer gets there five times sooner.
    expect(fast?.milesUntilSellThreshold).toBe(slow?.milesUntilSellThreshold)
    expect(fast?.daysUntilSellThreshold).toBe(100)
    expect(slow?.daysUntilSellThreshold).toBe(500)
  })

  it('reports MEDIUM confidence from only two readings', () => {
    const p = predictWear([reading(20_000, 10), reading(30_000, 8)], TIRE_THRESHOLDS, 40)
    expect(p?.confidence).toBe('MEDIUM')
    expect(p?.readingCount).toBe(2)
  })

  it('cannot project from a single visit but still reports current state', () => {
    const p = predictWear([reading(30_000, 3)], TIRE_THRESHOLDS, 40)
    expect(p?.currentValue).toBe(3)
    // Already past the 4/32 sell point, so the answer is "now" — no rate needed.
    expect(p?.milesUntilSellThreshold).toBe(0)
    expect(p?.isAtSellThreshold).toBe(true)
    // But 2/32 is still ahead, and one reading gives no rate to project with.
    expect(p?.milesUntilCriticalThreshold).toBeNull()
    expect(p?.isCritical).toBe(false)
    expect(p?.confidence).toBe('LOW')
  })

  it('flags a tire already at the legal minimum as critical', () => {
    const p = predictWear([reading(20_000, 6), reading(40_000, 2)], TIRE_THRESHOLDS, 40)
    expect(p?.isCritical).toBe(true)
    expect(p?.milesUntilCriticalThreshold).toBe(0)
    expect(p?.milesUntilSellThreshold).toBe(0)
  })

  it('refuses to project when the measurement went UP', () => {
    // New tires fitted between visits, or a mistyped measurement. Either way,
    // projecting from this would produce nonsense.
    const p = predictWear([reading(20_000, 4), reading(40_000, 10)], TIRE_THRESHOLDS, 40)
    expect(p?.currentValue).toBe(10)
    expect(p?.ratePerThousandMiles).toBe(0)
    expect(p?.milesUntilSellThreshold).toBeNull()
    expect(p?.confidence).toBe('LOW')
  })

  it('handles two readings taken at the same odometer', () => {
    const p = predictWear([reading(30_000, 8), reading(30_000, 7)], TIRE_THRESHOLDS, 40)
    expect(p?.milesUntilSellThreshold).toBeNull()
  })

  it('omits day estimates when miles-per-day is unknown', () => {
    const p = predictWear([reading(20_000, 10), reading(30_000, 8)], TIRE_THRESHOLDS, null)
    expect(p?.milesUntilSellThreshold).toBe(20_000)
    expect(p?.daysUntilSellThreshold).toBeNull()
  })

  it('predicts brake pad wear on the same machinery', () => {
    const p = predictWear([reading(20_000, 10), reading(35_000, 6)], BRAKE_THRESHOLDS, 40)
    expect(p?.currentValue).toBe(6)
    expect(p?.milesUntilSellThreshold).toBe(7_500)
  })

  it('returns null with no readings at all', () => {
    expect(predictWear([], TIRE_THRESHOLDS, 40)).toBeNull()
  })
})

describe('worst corner selection', () => {
  it('sells on the worst tire, not the average', () => {
    const byPosition = new Map<string, WearReading[]>([
      ['LF', [reading(20_000, 10), reading(40_000, 8)]],
      ['RF', [reading(20_000, 10), reading(40_000, 3)]], // the problem corner
      ['LR', [reading(20_000, 10), reading(40_000, 9)]],
      ['RR', [reading(20_000, 10), reading(40_000, 9)]],
    ])
    const worst = predictWorstCorner(byPosition, TIRE_THRESHOLDS, 40)
    expect(worst?.position).toBe('RF')
    expect(worst?.prediction.currentValue).toBe(3)
    expect(worst?.prediction.isAtSellThreshold).toBe(true)
  })

  it('returns null when no corner has data', () => {
    expect(predictWorstCorner(new Map(), TIRE_THRESHOLDS, 40)).toBeNull()
  })
})
