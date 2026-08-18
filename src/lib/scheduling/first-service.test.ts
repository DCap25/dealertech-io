import { describe, expect, it } from 'vitest'
import { firstServiceDefault, FALLBACK_FIRST_SERVICE, type MaintenanceIntervalRow } from './index'

/**
 * The date the introduction form opens on — DRIVE_PLAN D5.
 *
 * Local wall-clock dates throughout, like the rest of the scheduling engine:
 * the store books in its own day, and a UTC midnight is one hour of drift away
 * from being the day before.
 */

const DELIVERY = new Date('2026-08-18T12:00:00') // a Tuesday

function row(over: Partial<MaintenanceIntervalRow> = {}): MaintenanceIntervalRow {
  return {
    make: 'FORD',
    modelYearFrom: null,
    modelYearTo: null,
    intervalMiles: 7500,
    intervalMonths: 6,
    description: 'Ford scheduled maintenance',
    ...over,
  }
}

describe('firstServiceDefault', () => {
  it('falls back to the stated interval when nothing matches', () => {
    const out = firstServiceDefault({
      from: DELIVERY, make: 'FORD', modelYear: 2026, schedules: [],
    })
    expect(out.basis).toBe('FALLBACK')
    expect(out.months).toBe(FALLBACK_FIRST_SERVICE.months)
    expect(out.miles).toBe(FALLBACK_FIRST_SERVICE.miles)
    expect(out.description).toBeNull()
    // Six months from 18 August is 18 February.
    expect(out.date.getFullYear()).toBe(2027)
    expect(out.date.getMonth()).toBe(1)
    expect(out.date.getDate()).toBe(18)
  })

  it('uses the store schedule and says whose number it is', () => {
    const out = firstServiceDefault({
      from: DELIVERY, make: 'FORD', modelYear: 2026,
      schedules: [row({ intervalMonths: 12, intervalMiles: 10000 })],
    })
    expect(out.basis).toBe('SCHEDULE')
    expect(out.months).toBe(12)
    expect(out.description).toBe('Ford scheduled maintenance')
    expect(out.date.getFullYear()).toBe(2027)
    expect(out.date.getMonth()).toBe(7)
  })

  it('takes the soonest of several schedules, not the first or the longest', () => {
    // A make with an oil interval and a 30k service has both; the FIRST
    // service after delivery is the soonest, and booking the two-year item
    // would look deliberate rather than wrong.
    const out = firstServiceDefault({
      from: DELIVERY, make: 'FORD', modelYear: 2026,
      schedules: [
        row({ intervalMonths: 24, description: 'Major service' }),
        row({ intervalMonths: 6, description: 'Oil and filter' }),
        row({ intervalMonths: 12, description: 'Cabin filter' }),
      ],
    })
    expect(out.months).toBe(6)
    expect(out.description).toBe('Oil and filter')
  })

  it('ignores another make entirely', () => {
    const out = firstServiceDefault({
      from: DELIVERY, make: 'FORD', modelYear: 2026,
      schedules: [row({ make: 'TOYOTA', intervalMonths: 12 })],
    })
    expect(out.basis).toBe('FALLBACK')
  })

  it('matches case-insensitively, because a make arrives spelled how it was typed', () => {
    const out = firstServiceDefault({
      from: DELIVERY, make: 'ford', modelYear: 2026,
      schedules: [row({ make: 'Ford', intervalMonths: 9 })],
    })
    expect(out.months).toBe(9)
  })

  it('honours model-year bounds, and treats an open bound as open', () => {
    const bounded = firstServiceDefault({
      from: DELIVERY, make: 'FORD', modelYear: 2019,
      schedules: [row({ modelYearFrom: 2021, intervalMonths: 12 })],
    })
    expect(bounded.basis).toBe('FALLBACK')

    const open = firstServiceDefault({
      from: DELIVERY, make: 'FORD', modelYear: 2030,
      schedules: [row({ modelYearFrom: 2021, intervalMonths: 12 })],
    })
    expect(open.basis).toBe('SCHEDULE')
  })

  it('converts a miles-only interval into months rather than dropping the row', () => {
    const out = firstServiceDefault({
      from: DELIVERY, make: 'FORD', modelYear: 2026,
      schedules: [row({ intervalMonths: null, intervalMiles: 10000 })],
    })
    expect(out.basis).toBe('SCHEDULE')
    expect(out.months).toBe(10) // 10,000 miles at the stated 1,000/month
  })

  it('rolls forward onto a day the store is open', () => {
    // 18 February 2027 is a Thursday; shut Thursday and Friday and it should
    // land on the Saturday rather than showing an empty slot grid.
    const closed = new Set([4, 5])
    const out = firstServiceDefault({
      from: DELIVERY, make: 'FORD', modelYear: 2026, schedules: [],
      isOpen: (d) => !closed.has(d.getDay()),
    })
    expect(out.date.getDay()).toBe(6)
    expect(out.date.getDate()).toBe(20)
  })

  it('gives up after a week rather than searching forever', () => {
    const out = firstServiceDefault({
      from: DELIVERY, make: 'FORD', modelYear: 2026, schedules: [],
      isOpen: () => false,
    })
    // Seven steps taken and then the date stands; the form says "closed",
    // which is true.
    expect(out.date.getDate()).toBe(25)
  })
})
