import { describe, expect, it } from 'vitest'
import {
  buildWearView, confidenceNote, formatHorizon, formatMiles, mileageAtThreshold,
  projectedDate, projectedValueAt, projectionPolyline, scaleX, scaleY, seriesPolyline, toneFor,
} from './wear-view'
import { TIRE_THRESHOLDS, predictWear, type WearReading } from './wear'
import type { InspectionSnapshot } from './types'

function snapshot(
  mileage: number,
  items: { group: string; position: string | null; value: number }[],
  day = 1,
): InspectionSnapshot {
  return {
    mileage,
    recordedAt: new Date(`2026-0${day}-15T12:00:00Z`),
    items: items.map((i) => ({
      itemKey: `${i.group}_${i.position ?? 'ALL'}`,
      componentGroupKey: i.group,
      value: i.value,
      unit: i.group === 'TIRES' ? 'THIRTY_SECONDS' : 'MILLIMETERS',
      position: i.position,
    })),
  }
}

/** Maria Perez's real shape: two visits, four corners, RF worst. */
function tireHistory(): InspectionSnapshot[] {
  return [
    snapshot(28031, [
      { group: 'TIRES', position: 'LF', value: 7 },
      { group: 'TIRES', position: 'RF', value: 8 },
      { group: 'TIRES', position: 'LR', value: 8 },
      { group: 'TIRES', position: 'RR', value: 6 },
      { group: 'BRAKE_PADS_SHOES', position: null, value: 11 },
    ], 1),
    snapshot(33290, [
      { group: 'TIRES', position: 'LF', value: 5 },
      { group: 'TIRES', position: 'RF', value: 4 },
      { group: 'TIRES', position: 'LR', value: 6 },
      { group: 'TIRES', position: 'RR', value: 6 },
      { group: 'BRAKE_PADS_SHOES', position: null, value: 9 },
    ], 6),
  ]
}

describe('buildWearView', () => {
  it('builds one series per corner and ignores other components', () => {
    const view = buildWearView('TIRES', tireHistory(), 30)!
    expect(view.series.map((s) => s.position)).toEqual(['LF', 'RF', 'LR', 'RR'])
  })

  it('picks the corner with the lowest current value as worst', () => {
    // RF fell fastest (8 → 4) and is the reason the job gets recommended.
    const view = buildWearView('TIRES', tireHistory(), 30)!
    expect(view.worst?.position).toBe('RF')
    expect(view.series.filter((s) => s.isWorst)).toHaveLength(1)
  })

  it('groups brakes under a single aggregate position', () => {
    const view = buildWearView('BRAKES', tireHistory(), 30)!
    expect(view.series).toHaveLength(1)
    expect(view.series[0]?.position).toBe('ALL')
  })

  it('returns null when nothing was measured for that component', () => {
    expect(buildWearView('BRAKES', [snapshot(1000, [{ group: 'TIRES', position: 'LF', value: 8 }])], 30)).toBeNull()
  })

  it('extends the axis to where the worst corner hits the legal minimum', () => {
    const view = buildWearView('TIRES', tireHistory(), 30)!
    // RF is at 4/32 and drops ~0.76/32 per 1,000 miles, so 2/32 is ~2,600 miles out.
    expect(view.scale.xMax).toBeGreaterThan(view.latestMileage)
    expect(view.scale.xMax).toBeLessThan(view.latestMileage + 40_000)
  })

  it('never lets the axis run away on a slowly wearing tire', () => {
    // A tire losing 0.1/32 per 1,000 miles would otherwise push the axis out
    // past 200,000 miles and squash every real reading into the left edge.
    const slow = [
      snapshot(10_000, [{ group: 'TIRES', position: 'LF', value: 10 }], 1),
      snapshot(20_000, [{ group: 'TIRES', position: 'LF', value: 9.9 }], 6),
    ]
    const view = buildWearView('TIRES', slow, 30)!
    expect(view.scale.xMax).toBeLessThanOrEqual(view.latestMileage + 40_000)
  })

  it('uses the same current value the engine reports', () => {
    const view = buildWearView('TIRES', tireHistory(), 30)!
    const engine = predictWear(view.worst!.readings, TIRE_THRESHOLDS, 30)!
    expect(view.worst?.prediction?.currentValue).toBe(engine.currentValue)
    expect(view.worst?.prediction?.ratePerThousandMiles).toBe(engine.ratePerThousandMiles)
  })
})

describe('projectedValueAt', () => {
  const prediction = predictWear(
    [
      { mileage: 28031, value: 8, recordedAt: new Date('2026-01-15T12:00:00Z') },
      { mileage: 33290, value: 4, recordedAt: new Date('2026-06-15T12:00:00Z') },
    ],
    TIRE_THRESHOLDS,
    30,
  )!

  it('returns the current value at the latest reading', () => {
    // The line is anchored on the latest measurement, which is exactly what
    // the engine uses for miles-to-threshold. Any other anchor would draw a
    // picture that disagrees with the number printed next to it.
    expect(projectedValueAt(prediction, 33290, 33290)).toBeCloseTo(4, 5)
  })

  it('falls as mileage increases', () => {
    expect(projectedValueAt(prediction, 33290, 34290)).toBeLessThan(4)
  })
})

describe('mileageAtThreshold', () => {
  const prediction = predictWear(
    [
      { mileage: 28031, value: 8, recordedAt: new Date('2026-01-15T12:00:00Z') },
      { mileage: 33290, value: 4, recordedAt: new Date('2026-06-15T12:00:00Z') },
    ],
    TIRE_THRESHOLDS,
    30,
  )!

  it('agrees with the engine on miles remaining', () => {
    const at = mileageAtThreshold(prediction, 33290, 2)!
    expect(at - 33290).toBeCloseTo(prediction.milesUntilCriticalThreshold!, -1)
  })

  it('returns the current odometer when already past the threshold', () => {
    expect(mileageAtThreshold(prediction, 33290, 4)).toBe(33290)
  })

  it('refuses to project when nothing is wearing', () => {
    // The engine reports rate 0 when measurements went up — a replacement.
    const replaced = predictWear(
      [
        { mileage: 10_000, value: 4, recordedAt: new Date('2026-01-15T12:00:00Z') },
        { mileage: 20_000, value: 10, recordedAt: new Date('2026-06-15T12:00:00Z') },
      ],
      TIRE_THRESHOLDS,
      30,
    )!
    expect(mileageAtThreshold(replaced, 20_000, 2)).toBeNull()
  })
})

describe('chart space', () => {
  const scale = { xMin: 0, xMax: 100, yMin: 0, yMax: 10 }

  it('maps mileage across the full width', () => {
    expect(scaleX(scale, 0)).toBe(0)
    expect(scaleX(scale, 100)).toBe(100)
    expect(scaleX(scale, 50)).toBe(50)
  })

  it('inverts y so a deeper measurement sits higher on the chart', () => {
    expect(scaleY(scale, 10)).toBe(0)
    expect(scaleY(scale, 0)).toBe(100)
  })

  it('does not divide by zero on a degenerate axis', () => {
    expect(scaleX({ ...scale, xMax: 0 }, 5)).toBe(0)
    expect(scaleY({ ...scale, yMax: 0 }, 5)).toBe(100)
  })

  it('emits a polyline point per reading', () => {
    const readings: WearReading[] = [
      { mileage: 0, value: 10, recordedAt: new Date() },
      { mileage: 100, value: 0, recordedAt: new Date() },
    ]
    expect(seriesPolyline(scale, readings).split(' ')).toHaveLength(2)
  })

  it('omits the projection line when nothing is wearing', () => {
    const flat = predictWear(
      [{ mileage: 10_000, value: 8, recordedAt: new Date() }],
      TIRE_THRESHOLDS,
      30,
    )!
    expect(projectionPolyline(scale, flat, 10_000)).toBeNull()
  })

  it('never draws the projection below the axis floor', () => {
    const prediction = predictWear(
      [
        { mileage: 0, value: 10, recordedAt: new Date() },
        { mileage: 50, value: 1, recordedAt: new Date() },
      ],
      TIRE_THRESHOLDS,
      30,
    )!
    const line = projectionPolyline(scale, prediction, 50)!
    const endY = Number(line.split(' ')[1]!.split(',')[1])
    expect(endY).toBeLessThanOrEqual(100)
  })
})

describe('formatHorizon', () => {
  it('says now when it is already there', () => {
    expect(formatHorizon(0)).toBe('now')
  })

  it('uses days, weeks, months and years as the distance grows', () => {
    expect(formatHorizon(9)).toContain('days')
    expect(formatHorizon(30)).toContain('weeks')
    expect(formatHorizon(120)).toContain('months')
    expect(formatHorizon(900)).toContain('years')
  })

  it('is null when the driving rate is unknown', () => {
    expect(formatHorizon(null)).toBeNull()
  })
})

describe('projectedDate and formatMiles', () => {
  it('adds the projected days to the starting date', () => {
    const from = new Date('2026-08-12T12:00:00Z')
    expect(projectedDate(from, 30)?.toISOString().slice(0, 10)).toBe('2026-09-11')
  })

  it('is null without a projection', () => {
    expect(projectedDate(new Date(), null)).toBeNull()
  })

  it('formats mileage with separators', () => {
    expect(formatMiles(12345.6)).toBe('12,346 mi')
  })
})

describe('toneFor', () => {
  const build = (values: [number, number]) =>
    predictWear(
      [
        { mileage: 10_000, value: values[0], recordedAt: new Date() },
        { mileage: 20_000, value: values[1], recordedAt: new Date() },
      ],
      TIRE_THRESHOLDS,
      30,
    )!

  it('flags at or below the legal minimum as critical', () => {
    expect(toneFor(build([6, 2]))).toBe('CRITICAL')
  })

  it('flags the sell point as due', () => {
    expect(toneFor(build([8, 4]))).toBe('DUE')
  })

  it('treats a healthy, slowly wearing tire as healthy', () => {
    expect(toneFor(build([11, 10.9]))).toBe('HEALTHY')
  })

  it('is healthy rather than throwing with no prediction', () => {
    expect(toneFor(null)).toBe('HEALTHY')
  })
})

describe('confidenceNote', () => {
  it('says plainly when a single reading is not a forecast', () => {
    const one = predictWear([{ mileage: 10_000, value: 8, recordedAt: new Date() }], TIRE_THRESHOLDS, 30)!
    expect(confidenceNote(one)).toContain('not a forecast')
  })

  it('explains a detected replacement rather than showing a bogus line', () => {
    // The engine refuses to project when measurements go up; the advisor needs
    // to know why the chart has no projection on it.
    const replaced = predictWear(
      [
        { mileage: 10_000, value: 4, recordedAt: new Date() },
        { mileage: 20_000, value: 10, recordedAt: new Date() },
      ],
      TIRE_THRESHOLDS,
      30,
    )!
    expect(confidenceNote(replaced)).toContain('replaced')
  })

  it('distinguishes two measurements from a real trend', () => {
    const two = predictWear(
      [
        { mileage: 10_000, value: 8, recordedAt: new Date() },
        { mileage: 20_000, value: 6, recordedAt: new Date() },
      ],
      TIRE_THRESHOLDS,
      30,
    )!
    const three = predictWear(
      [
        { mileage: 10_000, value: 8, recordedAt: new Date() },
        { mileage: 20_000, value: 6, recordedAt: new Date() },
        { mileage: 30_000, value: 4, recordedAt: new Date() },
      ],
      TIRE_THRESHOLDS,
      30,
    )!
    expect(confidenceNote(two)).toContain('2 measurements')
    expect(confidenceNote(three)).toContain('trend, not a guess')
  })

  it('handles a missing prediction', () => {
    expect(confidenceNote(null)).toContain('No measurements')
  })
})
