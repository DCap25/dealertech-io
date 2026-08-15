import { describe, expect, it } from 'vitest'
import { reconcileOdometer, type MileageObservation } from './reconcile'

const seen = (mileage: number, over: Partial<MileageObservation> = {}): MileageObservation => ({
  mileage,
  source: 'an inspection',
  recordedAt: new Date('2026-07-04T12:00:00'),
  ...over,
})

describe('reconcileOdometer', () => {
  it('uses the vehicle record when nothing contradicts it', () => {
    const result = reconcileOdometer(92_659, [seen(88_000), seen(67_591)])
    expect(result.mileage).toBe(92_659)
    expect(result.correction).toBeNull()
  })

  it('uses the vehicle record when there is no history at all', () => {
    const result = reconcileOdometer(51_140, [])
    expect(result.mileage).toBe(51_140)
    expect(result.correction).toBeNull()
  })

  it('prefers a higher figure from the same payload', () => {
    // The bundle contradicts itself: a vehicle record at 50,000 arriving with
    // an inspection taken at 92,000. Nothing external is needed to know which
    // one cannot be right.
    const result = reconcileOdometer(50_000, [seen(92_000)])
    expect(result.mileage).toBe(92_000)
    expect(result.correction?.reported).toBe(50_000)
    expect(result.correction?.used).toBe(92_000)
  })

  it('names both numbers and where the higher one came from', () => {
    // An alert saying only "odometer looks wrong" cannot be acted on. The
    // advisor needs to know what to go and check.
    const result = reconcileOdometer(50_000, [seen(92_000, { source: 'a closed repair order' })])
    expect(result.correction?.message).toContain('50,000')
    expect(result.correction?.message).toContain('92,000')
    expect(result.correction?.message).toContain('a closed repair order')
  })

  it('takes the highest observation, not the most recent one', () => {
    // Records arrive back-dated and out of order. The highest odometer any
    // source has seen is the floor for where the vehicle is now.
    const result = reconcileOdometer(10_000, [
      seen(88_000, { recordedAt: new Date('2025-01-01') }),
      seen(60_000, { recordedAt: new Date('2026-08-01') }),
    ])
    expect(result.mileage).toBe(88_000)
  })

  it('treats a missing odometer as zero and takes whatever history knows', () => {
    // A vehicle record with no odometer used to reach the engine as 0, which
    // makes every mileage-based warranty look wide open.
    const result = reconcileOdometer(null, [seen(74_500)])
    expect(result.mileage).toBe(74_500)
    expect(result.correction?.reported).toBe(0)
  })

  it('is null-safe about a missing odometer with no history either', () => {
    expect(reconcileOdometer(null, [])).toEqual({ mileage: 0, correction: null })
  })

  it('ignores junk observations rather than trusting them', () => {
    // Zero and negative odometers are how "unknown" reaches us from real
    // systems. Letting one win would be worse than ignoring it.
    const result = reconcileOdometer(51_140, [seen(0), seen(-1), seen(Number.NaN)])
    expect(result.mileage).toBe(51_140)
    expect(result.correction).toBeNull()
  })

  it('omits the date when an observation has none', () => {
    const result = reconcileOdometer(1_000, [seen(9_000, { recordedAt: null })])
    expect(result.correction?.message).not.toContain('undefined')
    expect(result.correction?.message).not.toContain('on ,')
  })
})
