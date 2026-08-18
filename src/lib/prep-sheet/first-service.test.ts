import { describe, expect, it } from 'vitest'
import { firstServiceCue } from './first-service'
import type { PrepSheet } from './types'
import type { Contract } from '@/lib/coverage'

/**
 * The delivery introduction's cue on the drive — DRIVE_PLAN D5.
 *
 * Midday fixtures, like every other date in these engines: date-fns compares in
 * local time and a midnight-UTC date lands on the previous day west of
 * Greenwich, which would make "delivered 3 days ago" machine-dependent.
 */

const NOW = new Date('2026-08-18T12:00:00')

function sheet(over: {
  visitContext?: string | null
  soldByName?: string | null
  introducedAdvisorName?: string | null
  visitCount?: number
  inServiceDate?: Date | null
  contracts?: Contract[]
} = {}): PrepSheet {
  return {
    customer: {
      id: 'c1', name: 'Maria Garcia', visitCount: over.visitCount ?? 0,
      lifetimeSpend: 0, lastVisitAt: null, preferredChannel: 'SMS', pinnedNotes: [],
    },
    vehicle: {
      id: 'v1', vin: '1FTFW1ET9DFC10312', make: 'FORD', model: 'F-150', modelYear: 2026,
      inServiceDate: over.inServiceDate === undefined
        ? new Date('2026-06-18T12:00:00')
        : over.inServiceDate,
      currentMileage: 1_800, avgMilesPerDay: 30, isHybridOrEv: false, isOriginalOwner: true,
    },
    appointment: {
      id: 'a1',
      scheduledAt: NOW,
      promisedAt: null,
      transportType: 'WAITER',
      concerns: null,
      advisorName: 'Dana Whitfield',
      visitContext: over.visitContext === undefined ? 'FIRST_SERVICE' : over.visitContext,
      soldByName: over.soldByName === undefined ? 'Elena Vasquez' : over.soldByName,
      introducedAdvisorName: over.introducedAdvisorName === undefined
        ? 'Dana Whitfield'
        : over.introducedAdvisorName,
    },
    warranty: { known: true } as PrepSheet['warranty'],
    contracts: over.contracts ?? [],
    prepaidEntitlements: [],
    inspectionHistory: [],
    projectedMileage: 1_800,
    opportunities: [],
    totals: { opportunityValue: 0, customerOutOfPocket: 0, coveredValue: 0 },
    alerts: [],
  }
}

describe('firstServiceCue', () => {
  it('says nothing at all about an ordinary visit', () => {
    expect(firstServiceCue(sheet({ visitContext: null }), NOW)).toBeNull()
  })

  it('names both halves of the handshake', () => {
    const cue = firstServiceCue(sheet(), NOW)
    expect(cue?.label).toBe('First service')
    expect(cue?.attribution).toBe('Sold by Elena Vasquez · introduced to Dana Whitfield')
  })

  it('still fires when nobody was introduced — the visit is still their first', () => {
    const cue = firstServiceCue(sheet({ introducedAdvisorName: null }), NOW)
    expect(cue?.attribution).toBe('Sold by Elena Vasquez')
  })

  it('leaves attribution null rather than printing an empty separator', () => {
    const cue = firstServiceCue(sheet({ soldByName: null, introducedAdvisorName: null }), NOW)
    expect(cue?.attribution).toBeNull()
    expect(cue?.label).toBe('First service')
  })

  it('leads with "never been in" for a genuinely new service customer', () => {
    const cue = firstServiceCue(sheet({ visitCount: 0 }), NOW)
    expect(cue?.notes[0]).toContain('never been in')
  })

  it('tells the truth about a repeat customer who bought a second car', () => {
    const cue = firstServiceCue(sheet({ visitCount: 4 }), NOW)
    expect(cue?.notes[0]).toContain('4 previous visits')
  })

  it('dates the delivery off the in-service date', () => {
    const cue = firstServiceCue(sheet({
      inServiceDate: new Date('2026-08-15T12:00:00'),
    }), NOW)
    expect(cue?.notes.some((n) => n === 'Delivered 3 days ago.')).toBe(true)
  })

  it('rounds to months once the car is no longer new-new', () => {
    const cue = firstServiceCue(sheet({
      inServiceDate: new Date('2026-05-18T12:00:00'),
    }), NOW)
    expect(cue?.notes.some((n) => n === 'Delivered about 3 months ago.')).toBe(true)
  })

  it('says nothing about delivery when the in-service date is missing or absurd', () => {
    const none = firstServiceCue(sheet({ inServiceDate: null }), NOW)
    expect(none?.notes.some((n) => n.startsWith('Delivered'))).toBe(false)

    // A date in the future is a placeholder, not a delivery.
    const future = firstServiceCue(sheet({
      inServiceDate: new Date('2027-01-01T12:00:00'),
    }), NOW)
    expect(future?.notes.some((n) => n.startsWith('Delivered'))).toBe(false)
  })

  it('points at the coverage panel rather than restating the contracts', () => {
    const cue = firstServiceCue(sheet({
      contracts: [
        { status: 'ACTIVE' } as Contract,
        { status: 'ACTIVE' } as Contract,
        { status: 'EXPIRED' } as Contract,
      ],
    }), NOW)
    const note = cue?.notes.find((n) => n.includes('coverage'))
    expect(note).toContain('2 coverage products')
    expect(note).toContain('see the coverage panel')
  })

  it('never runs to more than three sentences in the lane', () => {
    const cue = firstServiceCue(sheet({
      visitCount: 2,
      contracts: [{ status: 'ACTIVE' } as Contract],
    }), NOW)
    expect(cue!.notes.length).toBeLessThanOrEqual(3)
  })
})
