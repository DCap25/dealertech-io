import { describe, expect, it } from 'vitest'
import {
  assembleEvents, assembleTimeline, buildVisitCard, declineEvents, groupByDay,
  itemsOfSnapshot, menuEvents, openThreads, readPresentation, repairOrderEvents,
  taskEvents, visitOutcomeEvents,
} from './index'
import type {
  TimelineAppointment, TimelineDecline, TimelineInput, TimelineOutcome,
  TimelinePresentation, TimelineRepairOrder, TimelineTask,
} from './types'

/**
 * The timeline is a read-model, so almost every test here is about the same
 * question: does the merged story say what actually happened, in the order it
 * happened, with an identity a screen can key on?
 */

const EMPTY: TimelineInput = {
  appointments: [], presentations: [], repairOrders: [], declines: [], outcomes: [],
  handoffs: [], calls: [], tasks: [], notes: [], mileage: [], vehicleLabels: {},
}

function input(over: Partial<TimelineInput> = {}): TimelineInput {
  return { ...EMPTY, ...over }
}

function appointment(over: Partial<TimelineAppointment> = {}): TimelineAppointment {
  return {
    id: 'ap1',
    vehicleId: 'v1',
    scheduledAt: new Date('2026-08-10T14:00:00Z'),
    promisedAt: null,
    status: 'DELIVERED',
    source: 'PHONE',
    transportType: 'DROP_OFF',
    concerns: null,
    visitContext: null,
    cancelledAt: null,
    cancellationReason: null,
    advisorName: 'Marcus Webb',
    ...over,
  }
}

function snapshot(items: { id: string; title: string; price?: number; confirmed?: boolean }[]) {
  return {
    tiers: [
      {
        tier: 'SAFETY',
        items: items.map((i) => ({
          id: i.id,
          title: i.title,
          customerOutOfPocket: i.price ?? 100,
          priceConfirmed: i.confirmed ?? true,
        })),
      },
    ],
  }
}

function presentation(over: Partial<TimelinePresentation> = {}): TimelinePresentation {
  return {
    id: 'p1',
    appointmentId: 'ap1',
    channel: 'TABLET',
    sequence: 1,
    startedAt: new Date('2026-08-10T15:00:00Z'),
    authorizedAt: null,
    authorizedName: null,
    snapshot: snapshot([
      { id: 'BRAKES', title: 'Front brake pads' },
      { id: 'ALIGN', title: 'Four-wheel alignment' },
    ]),
    authorizedSnapshot: null,
    decisions: {},
    ...over,
  }
}

function decline(over: Partial<TimelineDecline> = {}): TimelineDecline {
  return {
    id: 'd1',
    vehicleId: 'v1',
    description: 'Rear brake rotors',
    quotedAmount: 480,
    declinedAt: new Date('2026-05-02T16:00:00Z'),
    declineReason: null,
    resolvedAt: null,
    ...over,
  }
}

function task(over: Partial<TimelineTask> = {}): TimelineTask {
  return {
    id: 't1',
    vehicleId: 'v1',
    title: 'Follow up on declined rotors',
    detail: null,
    trigger: 'DECLINED_SERVICE_FOLLOW_UP',
    status: 'PENDING',
    priority: 50,
    estimatedValue: 480,
    dueAt: new Date('2026-06-02T16:00:00Z'),
    createdAt: new Date('2026-05-03T16:00:00Z'),
    completedAt: null,
    outcome: null,
    ...over,
  }
}

// ===========================================================================

describe('event identity', () => {
  it('names the source table and the row it came from', () => {
    const events = assembleEvents(input({ appointments: [appointment()] }))
    expect(events[0]?.id).toBe('appointments:ap1')
  })

  it('gives one row its two moments distinct ids', () => {
    const ro: TimelineRepairOrder = {
      id: 'ro1',
      vehicleId: 'v1',
      roNumber: '48120',
      status: 'CLOSED',
      openedAt: new Date('2026-08-10T14:30:00Z'),
      closedAt: new Date('2026-08-10T19:00:00Z'),
      mileageIn: 41200,
      customerPayTotal: 610,
      advisorName: 'Marcus Webb',
      lines: [{ description: 'Front brake pads', payType: 'CUSTOMER_PAY', status: 'COMPLETE', customerAmount: 610 }],
    }

    const ids = repairOrderEvents(input({ repairOrders: [ro] })).map((e) => e.id)
    expect(ids).toEqual(['repair_orders:ro1:opened', 'repair_orders:ro1:closed'])
    expect(new Set(ids).size).toBe(2)
  })

  it('keeps every id unique across a busy visit', () => {
    const events = assembleEvents(input({
      appointments: [appointment()],
      presentations: [presentation()],
      declines: [decline({ resolvedAt: new Date('2026-08-10T18:00:00Z') })],
      tasks: [task({ completedAt: new Date('2026-06-03T16:00:00Z') })],
    }))
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length)
  })
})

describe('the merge', () => {
  it('runs newest first', () => {
    const events = assembleEvents(input({
      appointments: [
        appointment({ id: 'old', scheduledAt: new Date('2025-01-01T10:00:00Z') }),
        appointment({ id: 'new', scheduledAt: new Date('2026-08-10T10:00:00Z') }),
      ],
    }))
    expect(events.map((e) => e.rowId)).toEqual(['new', 'old'])
  })

  it('breaks a tied timestamp on identity rather than on fetch order', () => {
    const at = new Date('2026-08-10T10:00:00Z')
    const forwards = assembleEvents(input({
      appointments: [appointment({ id: 'b', scheduledAt: at }), appointment({ id: 'a', scheduledAt: at })],
    }))
    const backwards = assembleEvents(input({
      appointments: [appointment({ id: 'a', scheduledAt: at }), appointment({ id: 'b', scheduledAt: at })],
    }))
    expect(forwards.map((e) => e.id)).toEqual(backwards.map((e) => e.id))
  })

  it('dates a cancellation by when it was cancelled, not by the slot it freed', () => {
    const events = assembleEvents(input({
      appointments: [appointment({
        status: 'CANCELLED',
        scheduledAt: new Date('2026-09-01T14:00:00Z'),
        cancelledAt: new Date('2026-08-11T09:00:00Z'),
      })],
    }))
    expect(events[0]?.at.toISOString()).toBe('2026-08-11T09:00:00.000Z')
  })
})

describe('groupByDay', () => {
  it('collects a day together and keeps days newest first', () => {
    const days = groupByDay(assembleEvents(input({
      appointments: [
        appointment({ id: 'a', scheduledAt: new Date(2026, 7, 10, 9, 0) }),
        appointment({ id: 'b', scheduledAt: new Date(2026, 7, 10, 15, 0) }),
        appointment({ id: 'c', scheduledAt: new Date(2026, 7, 3, 9, 0) }),
      ],
    })))

    expect(days.map((d) => d.key)).toEqual(['2026-08-10', '2026-08-03'])
    expect(days[0]?.events).toHaveLength(2)
  })
})

describe('menu events', () => {
  it('reads the frozen row and says what the customer answered', () => {
    const [event] = menuEvents(input({
      appointments: [appointment()],
      presentations: [presentation({
        decisions: { BRAKES: 'ACCEPTED', ALIGN: 'CALL_ME' },
      })],
    }))

    expect(event?.title).toBe('Menu of 2 presented on the tablet · 1 yes, 1 call-me')
    expect(event?.amount).toBe(100)
    expect(event?.vehicleId).toBe('v1')
  })

  it('names the person who authorised it, and counts from what they authorised', () => {
    const [event] = menuEvents(input({
      appointments: [appointment()],
      presentations: [presentation({
        authorizedAt: new Date('2026-08-10T16:00:00Z'),
        authorizedName: 'Betty Lewis',
        authorizedSnapshot: {
          snapshot: snapshot([{ id: 'BRAKES', title: 'Front brake pads', price: 610 }]),
          decisions: { BRAKES: 'ACCEPTED' },
        },
        // The live column has moved on since she signed. It must not be what
        // the sentence is counted from.
        decisions: { BRAKES: 'DECLINED', ALIGN: 'DECLINED' },
      })],
    }))

    expect(event?.title).toBe('Menu of 1 presented on the tablet · 1 yes · authorised by Betty Lewis')
    expect(event?.amount).toBe(610)
    expect(event?.at.toISOString()).toBe('2026-08-10T16:00:00.000Z')
  })

  it('says so plainly when nobody has answered yet', () => {
    const [event] = menuEvents(input({ appointments: [appointment()], presentations: [presentation()] }))
    expect(event?.title).toContain('no answer yet')
  })

  it('drops an answer against an id the menu never showed', () => {
    const { decisions } = readPresentation(presentation({
      decisions: { BRAKES: 'ACCEPTED', NEVER_SHOWN: 'ACCEPTED' },
    }))
    expect(Object.keys(decisions)).toEqual(['BRAKES'])
  })

  it('survives a snapshot from before a field existed', () => {
    expect(itemsOfSnapshot(null)).toEqual([])
    expect(itemsOfSnapshot({ tiers: 'nonsense' })).toEqual([])
    expect(itemsOfSnapshot({ tiers: [{ items: [{ id: 'X', title: 'Thing' }] }] })).toEqual([
      { id: 'X', title: 'Thing', customerOutOfPocket: 0, priceConfirmed: true },
    ])
  })
})

describe('visit outcomes', () => {
  function outcome(over: Partial<TimelineOutcome> = {}): TimelineOutcome {
    return {
      appointmentId: 'ap1',
      vehicleId: 'v1',
      title: 'Front brake pads',
      outcome: 'ACCEPTED',
      estimatedAmount: 610,
      decidedAt: new Date('2026-08-10T18:00:00Z'),
      ...over,
    }
  }

  it('is one event per visit, not one per opportunity', () => {
    const events = visitOutcomeEvents(input({
      outcomes: [outcome(), outcome({ title: 'Alignment', outcome: 'SKIPPED', estimatedAmount: 160 })],
    }))
    expect(events).toHaveLength(1)
    expect(events[0]?.detail).toHaveLength(2)
  })

  it('says a call-me is a call-me rather than never raised', () => {
    const [event] = visitOutcomeEvents(input({
      outcomes: [
        outcome(),
        outcome({ title: 'Alignment', outcome: 'CALL_ME', estimatedAmount: 160 }),
      ],
    }))
    expect(event?.title).toBe('Sheet worked · 1 approved, 1 wants a call')
    expect(event?.detail).toContain('Alignment — wants a call')
  })

  it('identifies itself by the visit it belongs to', () => {
    const [event] = visitOutcomeEvents(input({ outcomes: [outcome()] }))
    expect(event?.id).toBe('prep_sheet_outcomes:ap1:visit')
  })
})

describe('declines', () => {
  it('shows the resurrection as its own moment', () => {
    const events = declineEvents(input({
      declines: [decline({ resolvedAt: new Date('2026-08-10T19:00:00Z') })],
    }))
    expect(events.map((e) => e.title)).toEqual([
      'Declined — Rear brake rotors',
      'Sold after all — Rear brake rotors',
    ])
  })

  it('warns while it is still open and stops once it is sold', () => {
    expect(declineEvents(input({ declines: [decline()] }))[0]?.tone).toBe('WARN')
    expect(
      declineEvents(input({ declines: [decline({ resolvedAt: new Date('2026-08-10T19:00:00Z') })] }))[0]?.tone,
    ).toBe('NEUTRAL')
  })
})

describe('tasks', () => {
  it('records the firing and the completion separately', () => {
    const events = taskEvents(input({ tasks: [task({ completedAt: new Date('2026-06-04T16:00:00Z'), outcome: 'BOOKED' })] }))
    expect(events).toHaveLength(2)
    expect(events[1]?.title).toContain('Follow-up done')
  })
})

// ===========================================================================

describe('open threads', () => {
  it('puts a call-me above every decline, however recent', () => {
    const threads = openThreads(input({
      appointments: [appointment()],
      presentations: [presentation({ decisions: { ALIGN: 'CALL_ME' } })],
      declines: [decline({ declinedAt: new Date('2026-08-11T10:00:00Z') })],
    }))

    expect(threads[0]?.kind).toBe('CALL_ME')
    expect(threads[0]?.priority).toBe(0)
    expect(threads[1]?.kind).toBe('OPEN_DECLINE')
  })

  it('orders inside a priority band newest first', () => {
    const threads = openThreads(input({
      declines: [
        decline({ id: 'older', description: 'Cabin filter', declinedAt: new Date('2024-01-01T10:00:00Z') }),
        decline({ id: 'newer', description: 'Rear rotors', declinedAt: new Date('2026-01-01T10:00:00Z') }),
      ],
    }))
    expect(threads.map((t) => t.title)).toEqual(['Rear rotors', 'Cabin filter'])
  })

  it('ignores a resolved decline', () => {
    const threads = openThreads(input({
      declines: [decline({ resolvedAt: new Date('2026-06-01T10:00:00Z') })],
    }))
    expect(threads).toEqual([])
  })

  it('leaves a pending answer alone — nobody asked, so there is nothing to chase', () => {
    const threads = openThreads(input({
      appointments: [appointment()],
      presentations: [presentation({ decisions: { ALIGN: 'PENDING', BRAKES: 'ACCEPTED' } })],
    }))
    expect(threads).toEqual([])
  })

  it('does not list the same brake job twice when the menu decline was written up', () => {
    const threads = openThreads(input({
      appointments: [appointment()],
      presentations: [presentation({
        snapshot: snapshot([{ id: 'ROTORS', title: 'Rear brake rotors' }]),
        decisions: { ROTORS: 'DECLINED' },
      })],
      declines: [decline({ description: 'Rear Brake Rotors!' })],
    }))

    expect(threads).toHaveLength(1)
    expect(threads[0]?.kind).toBe('OPEN_DECLINE')
  })

  it('never collapses a call-me into a declined_services row', () => {
    const threads = openThreads(input({
      appointments: [appointment()],
      presentations: [presentation({
        snapshot: snapshot([{ id: 'ROTORS', title: 'Rear brake rotors' }]),
        decisions: { ROTORS: 'CALL_ME' },
      })],
      declines: [decline({ description: 'Rear brake rotors' })],
    }))
    expect(threads.map((t) => t.kind)).toEqual(['CALL_ME', 'OPEN_DECLINE'])
  })

  it('keeps the newest answer when the same work was answered twice', () => {
    const threads = openThreads(input({
      appointments: [appointment()],
      presentations: [
        presentation({
          id: 'first',
          startedAt: new Date('2026-08-10T15:00:00Z'),
          decisions: { ALIGN: 'DECLINED' },
        }),
        presentation({
          id: 'second',
          startedAt: new Date('2026-08-10T17:00:00Z'),
          decisions: { ALIGN: 'CALL_ME' },
        }),
      ],
    }))

    expect(threads).toHaveLength(1)
    expect(threads[0]?.kind).toBe('CALL_ME')
  })

  it('respects the store’s own cadence priority', () => {
    const threads = openThreads(input({
      declines: [decline()],
      tasks: [task({ priority: 10, title: 'Thank-you call' })],
    }))
    expect(threads.map((t) => t.title)).toEqual(['Thank-you call', 'Rear brake rotors'])
  })

  it('ignores a completed task', () => {
    const threads = openThreads(input({ tasks: [task({ status: 'COMPLETED' })] }))
    expect(threads).toEqual([])
  })

  it('labels the car a thread is about', () => {
    const threads = openThreads(input({
      declines: [decline()],
      vehicleLabels: { v1: '2022 Toyota Camry' },
    }))
    expect(threads[0]?.vehicleLabel).toBe('2022 Toyota Camry')
  })

  it('hides a price the customer was never shown', () => {
    const threads = openThreads(input({
      appointments: [appointment()],
      presentations: [presentation({
        snapshot: snapshot([{ id: 'ALIGN', title: 'Alignment', price: 160, confirmed: false }]),
        decisions: { ALIGN: 'CALL_ME' },
      })],
    }))
    expect(threads[0]?.amount).toBeNull()
  })

  it('is the same list the assembled timeline carries', () => {
    const rows = input({ declines: [decline()] })
    expect(assembleTimeline(rows).threads).toEqual(openThreads(rows))
  })
})

// ===========================================================================

describe('the compressed card', () => {
  const asOf = new Date('2026-08-12T12:00:00Z')

  it('finds the last visit they turned up to and the next one booked', () => {
    const card = buildVisitCard(input({
      appointments: [
        appointment({ id: 'past', status: 'DELIVERED', scheduledAt: new Date('2026-03-02T14:00:00Z') }),
        appointment({ id: 'noshow', status: 'NO_SHOW', scheduledAt: new Date('2026-06-02T14:00:00Z') }),
        appointment({ id: 'future', status: 'SCHEDULED', scheduledAt: new Date('2026-09-02T14:00:00Z') }),
      ],
    }), asOf)

    expect(card.lastVisit?.href).toBe('/drive/past')
    expect(card.nextVisit?.href).toBe('/drive/future')
  })

  it('does not offer today’s own appointment as the next one', () => {
    const card = buildVisitCard(input({
      appointments: [appointment({ id: 'today', status: 'ARRIVED', scheduledAt: new Date('2026-08-12T08:30:00Z') })],
    }), asOf)

    expect(card.nextVisit).toBeNull()
    expect(card.lastVisit?.href).toBe('/drive/today')
  })

  it('says nothing rather than guessing when there is no history', () => {
    const card = buildVisitCard(input(), asOf)
    expect(card).toEqual({ lastVisit: null, nextVisit: null, threads: [] })
  })

  it('counts threads exactly as the record page does', () => {
    const rows = input({
      appointments: [appointment()],
      presentations: [presentation({ decisions: { ALIGN: 'CALL_ME' } })],
      declines: [decline()],
    })
    expect(buildVisitCard(rows, asOf).threads).toEqual(assembleTimeline(rows).threads)
  })
})
