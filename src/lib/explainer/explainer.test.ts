import { describe, expect, it } from 'vitest'
import { allExplainers, explainerFor, sceneAt, totalDurationMs } from './library'
import {
  formatReading, latestInspection, remainingFraction, statusOf, worstReadingFor,
} from './reading'
import type { InspectionSnapshot } from '@/lib/prep-sheet'
import { DEFAULT_INTERVALS } from '@/lib/prep-sheet/build'

function inspection(
  items: Partial<InspectionSnapshot['items'][number]>[],
  over: Partial<Pick<InspectionSnapshot, 'mileage' | 'recordedAt'>> = {},
): InspectionSnapshot {
  return {
    mileage: 51_140,
    recordedAt: new Date('2026-08-12T09:00:00'),
    ...over,
    items: items.map((i) => ({
      itemKey: 'x',
      componentGroupKey: null,
      value: null,
      unit: null,
      position: null,
      ...i,
    })),
  }
}

/** The common case: one inspection, taken at this visit. */
const history = (items: Partial<InspectionSnapshot['items'][number]>[]) => [inspection(items)]

describe('the library', () => {
  it('runs every explainer inside the 10–30 second brief', () => {
    // Long enough to explain, short enough that a customer standing at a
    // podium watches it to the end.
    for (const e of allExplainers()) {
      const seconds = totalDurationMs(e) / 1000
      expect(seconds, `${e.key} runs ${seconds}s`).toBeGreaterThanOrEqual(10)
      expect(seconds, `${e.key} runs ${seconds}s`).toBeLessThanOrEqual(30)
    }
  })

  it('gives every explainer a consequence that is not a deadline', () => {
    // "if ignored" states cause and effect. Anything that reads as time
    // pressure belongs to the advisor's judgement, not to a canned animation.
    const pressure = /\b(now|today|immediately|urgent|hurry|act fast|don'?t wait)\b/i
    for (const e of allExplainers()) {
      expect(e.ifIgnored.length, e.key).toBeGreaterThan(20)
      expect(pressure.test(e.ifIgnored), `${e.key}: "${e.ifIgnored}"`).toBe(false)
    }
  })

  it('states plainly when an item is comfort rather than safety', () => {
    // The cabin filter is the honesty test for the whole library. If we
    // oversell the cheap item, nobody believes us about the brakes.
    expect(explainerFor('CABIN_AIR_FILTER')?.candour).toMatch(/comfort/i)
    expect(explainerFor('ENGINE_AIR_FILTER')?.candour).toMatch(/fuel economy|MPG/i)
  })

  it('keys every scale to a limit a customer could verify', () => {
    for (const e of allExplainers()) {
      if (!e.scale) continue
      expect(e.scale.fresh, e.key).toBeGreaterThan(e.scale.present)
      expect(e.scale.present, e.key).toBeGreaterThan(e.scale.limit)
      expect(e.scale.limitMeans.length, e.key).toBeGreaterThan(10)
    }
  })

  it('has something to say about every service the menu can offer', () => {
    // The menu and the library are edited in different files, months apart.
    // A service with no explainer renders a "why?" button that does nothing,
    // in front of a customer, which is worse than not offering the button.
    for (const interval of DEFAULT_INTERVALS) {
      expect(
        explainerFor(interval.componentGroupKey),
        `${interval.description} (${interval.componentGroupKey}) is on the menu with no explainer`,
      ).not.toBeNull()
    }
    // Alignment reaches the menu from measured tread wear rather than from an
    // interval, so it is not in the list above.
    expect(explainerFor('WHEEL_ALIGNMENT')).not.toBeNull()
  })

  it('returns null for a group it has nothing to say about', () => {
    expect(explainerFor('SOMETHING_UNKNOWN')).toBeNull()
    expect(explainerFor(null)).toBeNull()
    expect(explainerFor(undefined)).toBeNull()
  })
})

describe('sceneAt', () => {
  const e = explainerFor('BRAKE_PADS_SHOES')!

  it('starts on the first scene', () => {
    expect(sceneAt(e, 0).index).toBe(0)
    expect(sceneAt(e, 0).progress).toBe(0)
  })

  it('advances through the scenes', () => {
    const first = e.scenes[0]!.holdMs
    expect(sceneAt(e, first - 1).index).toBe(0)
    expect(sceneAt(e, first + 1).index).toBe(1)
  })

  it('clamps at the end rather than looping', () => {
    // A player that restarts on its own takes the tablet back from whoever is
    // still reading the last caption.
    const total = totalDurationMs(e)
    const end = sceneAt(e, total + 60_000)
    expect(end.index).toBe(e.scenes.length - 1)
    expect(end.progress).toBe(1)
    expect(end.done).toBe(true)
  })

  it('clamps a negative elapsed time to the start', () => {
    expect(sceneAt(e, -500).index).toBe(0)
    expect(sceneAt(e, -500).progress).toBe(0)
  })
})

describe('latestInspection', () => {
  it('finds the newest whatever order the history arrives in', () => {
    // Nothing in the adapter contract promises an order. Taking the last
    // element showed a customer a reassuring 5/32" from an old visit when
    // that morning's measurement was 2/32".
    const old = inspection([], { recordedAt: new Date('2025-03-01'), mileage: 20_000 })
    const recent = inspection([], { recordedAt: new Date('2026-08-12'), mileage: 51_140 })
    const middle = inspection([], { recordedAt: new Date('2026-01-05'), mileage: 40_000 })

    expect(latestInspection([recent, old, middle])).toBe(recent)
    expect(latestInspection([old, middle, recent])).toBe(recent)
    expect(latestInspection([middle, recent, old])).toBe(recent)
  })

  it('breaks a same-day tie on the higher odometer', () => {
    const day = new Date('2026-08-12')
    const first = inspection([], { recordedAt: day, mileage: 51_100 })
    const second = inspection([], { recordedAt: day, mileage: 51_140 })
    expect(latestInspection([second, first])).toBe(second)
  })

  it('is null with no history', () => {
    expect(latestInspection([])).toBeNull()
    expect(latestInspection(null)).toBeNull()
  })
})

describe('worstReadingFor', () => {
  const tires = explainerFor('TIRES')!

  it('takes the worst corner, not the average', () => {
    // Two good tyres and two at the limit average out to something
    // reassuring. It is the pair at the limit that stops the car.
    const reading = worstReadingFor(
      tires,
      history([
        { componentGroupKey: 'TIRES', value: 9, unit: 'THIRTY_SECONDS', position: 'LF' },
        { componentGroupKey: 'TIRES', value: 3, unit: 'THIRTY_SECONDS', position: 'RF' },
        { componentGroupKey: 'TIRES', value: 8, unit: 'THIRTY_SECONDS', position: 'LR' },
      ]),
    )
    expect(reading).toEqual({ value: 3, unit: '32nds', position: 'RF' })
  })

  it('reads from this visit, not from an earlier one', () => {
    // The regression test for the bug above: an old inspection with healthy
    // tread must not override today's measurement.
    const reading = worstReadingFor(tires, [
      inspection(
        [{ componentGroupKey: 'TIRES', value: 2, unit: 'THIRTY_SECONDS', position: 'RF' }],
        { recordedAt: new Date('2026-08-12'), mileage: 51_140 },
      ),
      inspection(
        [{ componentGroupKey: 'TIRES', value: 9, unit: 'THIRTY_SECONDS', position: 'RR' }],
        { recordedAt: new Date('2024-05-02'), mileage: 21_000 },
      ),
    ])
    expect(reading).toEqual({ value: 2, unit: '32nds', position: 'RF' })
  })

  it('translates the inspection’s unit names', () => {
    const pads = explainerFor('BRAKE_PADS_SHOES')!
    const reading = worstReadingFor(
      pads,
      history([{ componentGroupKey: 'BRAKE_PADS_SHOES', value: 3, unit: 'MILLIMETERS' }]),
    )
    expect(reading?.value).toBe(3)
    expect(reading?.unit).toBe('mm')
  })

  it('ignores a measurement recorded in the wrong unit', () => {
    // Better to show the generic scale than to plot millimetres onto a
    // thirty-seconds axis and produce a confident, wrong picture.
    const reading = worstReadingFor(
      tires,
      history([{ componentGroupKey: 'TIRES', value: 3, unit: 'MILLIMETERS' }]),
    )
    expect(reading).toBeNull()
  })

  it('returns null when nothing was measured for that group', () => {
    expect(worstReadingFor(tires, history([]))).toBeNull()
    expect(worstReadingFor(tires, [])).toBeNull()
    expect(worstReadingFor(tires, null)).toBeNull()
  })

  it('returns null for an explainer with no scale', () => {
    const oil = explainerFor('OIL_CHANGE')!
    expect(
      worstReadingFor(oil, history([{ componentGroupKey: 'OIL_CHANGE', value: 5, unit: 'mm' }])),
    ).toBeNull()
  })
})

describe('statusOf', () => {
  const tires = explainerFor('TIRES')!

  it('calls 8/32 healthy, 4/32 present-now, 2/32 at the limit', () => {
    const at = (v: number) => statusOf(tires, { value: v, unit: '32nds', position: null })
    expect(at(8)).toBe('HEALTHY')
    expect(at(4)).toBe('PRESENT')
    expect(at(3)).toBe('PRESENT')
    expect(at(2)).toBe('AT_LIMIT')
    expect(at(1)).toBe('AT_LIMIT')
  })

  it('is null without a reading', () => {
    expect(statusOf(tires, null)).toBeNull()
  })
})

describe('remainingFraction', () => {
  const tires = explainerFor('TIRES')!

  it('is 1 when new and 0 at the limit', () => {
    expect(remainingFraction(tires, { value: 11, unit: '32nds', position: null })).toBe(1)
    expect(remainingFraction(tires, { value: 2, unit: '32nds', position: null })).toBe(0)
  })

  it('never goes below zero on a reading past the limit', () => {
    expect(remainingFraction(tires, { value: 1, unit: '32nds', position: null })).toBe(0)
  })
})

describe('formatReading', () => {
  it('writes each unit the way a repair order does', () => {
    expect(formatReading({ value: 3, unit: 'mm', position: 'LF' })).toBe('3mm')
    expect(formatReading({ value: 4, unit: '32nds', position: 'RF' })).toBe('4/32"')
  })
})
