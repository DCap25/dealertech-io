import { describe, expect, it } from 'vitest'
import {
  booksForDay, cardsByDay, dayKey, defaultWeekView, mineCards, toWeekCard,
  UNASSIGNED_LABEL, weekDays,
} from './week'
import type { PrepSheet } from '@/lib/prep-sheet'

function sheet(over: {
  id?: string
  scheduledAt?: Date
  advisorId?: string | null
  advisorName?: string | null
  urgencies?: ('SAFETY' | 'HIGH' | 'LOW')[]
  transportType?: string
  appointment?: false
}): PrepSheet {
  return {
    customer: { id: 'c1', name: 'Betty Lewis', visitCount: 1, lifetimeSpend: 0, lastVisitAt: null, preferredChannel: 'SMS', pinnedNotes: [] },
    vehicle: { id: 'v1', vin: 'X', make: 'FORD', model: 'Edge', modelYear: 2024, inServiceDate: null, currentMileage: 30_000, avgMilesPerDay: null, isHybridOrEv: false, isOriginalOwner: true },
    appointment: over.appointment === false ? undefined : {
      id: over.id ?? 'a1',
      scheduledAt: over.scheduledAt ?? new Date('2026-08-12T08:00:00'),
      promisedAt: null,
      transportType: over.transportType ?? 'DROP_OFF',
      concerns: null,
      advisorName: over.advisorName === undefined ? 'Marcus' : over.advisorName,
      advisorId: over.advisorId === undefined ? 'adv-1' : over.advisorId,
      status: 'SCHEDULED',
    },
    warranty: { terms: [] } as unknown as PrepSheet['warranty'],
    contracts: [], prepaidEntitlements: [], inspectionHistory: [],
    projectedMileage: 30_000,
    opportunities: (over.urgencies ?? ['LOW']).map((urgency, i) => ({
      id: `o${i}`, type: 'MAINTENANCE_DUE', title: 't', detail: 'd',
      estimatedAmount: 100, customerOutOfPocket: 100, likelyPayer: 'CUSTOMER_PAY',
      urgency, closeProbability: 0.5, priorityScore: 1, talkTrack: 'x',
    })) as PrepSheet['opportunities'],
    totals: { opportunityValue: 0, customerOutOfPocket: 0, coveredValue: 0 },
    alerts: [],
  } as PrepSheet
}

describe('toWeekCard', () => {
  it('derives the card from the sheet, safety flag off the engine output', () => {
    const card = toWeekCard(sheet({ urgencies: ['LOW', 'SAFETY'] }))!
    expect(card.customerName).toBe('Betty Lewis')
    expect(card.vehicleLabel).toBe('2024 FORD Edge')
    expect(card.hasSafetyItem).toBe(true)
    expect(card.isWaiter).toBe(false)
  })

  it('marks a waiter — the load that hurts', () => {
    expect(toWeekCard(sheet({ transportType: 'WAITER' }))!.isWaiter).toBe(true)
  })

  it('returns null for a sheet without an appointment', () => {
    expect(toWeekCard(sheet({ appointment: false }))).toBeNull()
  })
})

describe('weekDays', () => {
  it('returns Monday through Sunday around any anchor', () => {
    // 2026-08-12 is a Wednesday; the week is Mon 10th … Sun 16th.
    const days = weekDays(new Date('2026-08-12T12:00:00'))
    expect(days).toHaveLength(7)
    expect(dayKey(days[0]!)).toBe('2026-08-10')
    expect(dayKey(days[6]!)).toBe('2026-08-16')
    expect(days[0]!.getDay()).toBe(1)
  })

  it('keeps a Sunday anchor in its own week rather than the next', () => {
    const days = weekDays(new Date('2026-08-16T12:00:00'))
    expect(dayKey(days[0]!)).toBe('2026-08-10')
  })
})

describe('cardsByDay', () => {
  it('groups by calendar day, earliest first within a day', () => {
    const cards = [
      toWeekCard(sheet({ id: 'late', scheduledAt: new Date('2026-08-12T15:00:00') }))!,
      toWeekCard(sheet({ id: 'early', scheduledAt: new Date('2026-08-12T08:00:00') }))!,
      toWeekCard(sheet({ id: 'thu', scheduledAt: new Date('2026-08-13T09:00:00') }))!,
    ]
    const byDay = cardsByDay(cards)
    expect(byDay.get('2026-08-12')!.map((c) => c.appointmentId)).toEqual(['early', 'late'])
    expect(byDay.get('2026-08-13')!.map((c) => c.appointmentId)).toEqual(['thu'])
  })
})

describe('booksForDay', () => {
  const cards = [
    toWeekCard(sheet({ id: 'z1', advisorId: 'adv-z', advisorName: 'Zoe' }))!,
    toWeekCard(sheet({ id: 'm1', advisorId: 'adv-1', advisorName: 'Marcus' }))!,
    toWeekCard(sheet({ id: 'p1', advisorId: null, advisorName: null }))!,
    toWeekCard(sheet({ id: 'm2', advisorId: 'adv-1', advisorName: 'Marcus' }))!,
  ]

  it('groups into books ordered by name, the pool pinned last', () => {
    const books = booksForDay(cards)
    expect(books.map((b) => b.advisorName)).toEqual(['Marcus', 'Zoe', UNASSIGNED_LABEL])
    expect(books[0]!.cards.map((c) => c.appointmentId)).toEqual(['m1', 'm2'])
    expect(books[2]!.advisorId).toBeNull()
  })

  it('omits the pool row when nothing is unassigned', () => {
    const books = booksForDay(cards.filter((c) => c.advisorId !== null))
    expect(books.map((b) => b.advisorName)).toEqual(['Marcus', 'Zoe'])
  })
})

describe('mineCards', () => {
  it('is my book plus the pool I might claim, never a colleague’s', () => {
    const cards = [
      toWeekCard(sheet({ id: 'mine', advisorId: 'adv-1' }))!,
      toWeekCard(sheet({ id: 'pool', advisorId: null }))!,
      toWeekCard(sheet({ id: 'zoes', advisorId: 'adv-z', advisorName: 'Zoe' }))!,
    ]
    expect(mineCards(cards, 'adv-1').map((c) => c.appointmentId)).toEqual(['mine', 'pool'])
  })
})

describe('defaultWeekView', () => {
  it('lands advisors on Mine and everyone else on Everyone', () => {
    expect(defaultWeekView(true)).toBe('mine')
    expect(defaultWeekView(false)).toBe('all')
  })
})
