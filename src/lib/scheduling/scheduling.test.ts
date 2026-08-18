import { describe, expect, it } from 'vitest'
import {
  assignAdvisor, assignedBy, bookLoad, capacityWarnings, countByAdvisor, dayRulesFor,
  DEFAULT_RULES, mayOverrideHours, outsideHours, slotsForDay, waiterLoad,
  type AdvisorOnDuty, type DayRules, type ScheduledAppointment,
} from './index'

/*
  Local wall-clock dates throughout, because the engine works in the store's
  own day: 2026-08-11 is a Tuesday, 2026-08-15 a Saturday, 2026-08-16 a Sunday.
*/
const TUESDAY = new Date('2026-08-11T12:00:00')
const SATURDAY = new Date('2026-08-15T12:00:00')
const SUNDAY = new Date('2026-08-16T12:00:00')

function rules(over: Partial<DayRules> = {}): DayRules[] {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    openMinute: 8 * 60,
    closeMinute: 12 * 60,
    slotMinutes: 30,
    maxPerAdvisorSlot: 2,
    maxPerAdvisorDay: 4,
    maxWaitersPerSlot: 2,
    autoAssign: true,
    ...over,
  }))
}

let seq = 0
function appt(over: Partial<ScheduledAppointment> & { at: string }): ScheduledAppointment {
  return {
    appointmentId: over.appointmentId ?? `a${seq++}`,
    advisorId: over.advisorId === undefined ? 'marcus' : over.advisorId,
    scheduledAt: new Date(`2026-08-11T${over.at}`),
    isWaiter: over.isWaiter ?? false,
  }
}

const ADVISORS: AdvisorOnDuty[] = [
  { advisorId: 'marcus', name: 'Marcus Reyes', working: true },
  { advisorId: 'dana', name: 'Dana Whitfield', working: true },
]

// ---------------------------------------------------------------- rules

describe('dayRulesFor', () => {
  it('falls back to the shipped default when a store has configured nothing', () => {
    const monday = dayRulesFor([], new Date('2026-08-10T12:00:00'))
    expect(monday?.openMinute).toBe(7 * 60)
    expect(monday?.autoAssign).toBe(true)
  })

  it('treats a configured week with no row for the day as closed, not as default', () => {
    // A store that said "we work Tuesdays" and nothing else is not open Sunday.
    const only = [rules()[2]!]
    expect(dayRulesFor(only, TUESDAY)).not.toBeNull()
    expect(dayRulesFor(only, SUNDAY)).toBeNull()
  })

  it('ships a default week that is closed on Sunday and short on Saturday', () => {
    expect(dayRulesFor(DEFAULT_RULES, SUNDAY)).toBeNull()
    expect(dayRulesFor(DEFAULT_RULES, SATURDAY)?.closeMinute).toBe(14 * 60)
  })
})

// ---------------------------------------------------------------- slots

describe('slotsForDay', () => {
  it('cuts store hours into slot-length pieces', () => {
    const slots = slotsForDay(rules(), TUESDAY)
    expect(slots).toHaveLength(8) // 8:00 to 12:00, half-hourly
    expect(slots[0]!.start.getHours()).toBe(8)
    expect(slots[0]!.start.getMinutes()).toBe(0)
    expect(slots.at(-1)!.end.getHours()).toBe(12)
  })

  it('offers no slot that would run past closing', () => {
    const slots = slotsForDay(rules({ closeMinute: 11 * 60 + 45 }), TUESDAY)
    expect(slots.at(-1)!.end.getHours()).toBe(11)
    expect(slots.at(-1)!.end.getMinutes()).toBe(30)
  })

  it('is empty on a closed day', () => {
    expect(slotsForDay(DEFAULT_RULES, SUNDAY)).toEqual([])
  })
})

// ------------------------------------------------------------- hard stop

describe('outsideHours', () => {
  it('passes a time inside the store hours', () => {
    expect(outsideHours(rules(), new Date('2026-08-11T09:00:00'))).toBeNull()
  })

  it('names the day and the opening time when it is too early', () => {
    const said = outsideHours(rules(), new Date('2026-08-11T07:00:00'))
    expect(said).toContain('Tuesday')
    expect(said).toContain('before the store opens')
  })

  it('stops a booking after close, and on a closed day', () => {
    expect(outsideHours(rules(), new Date('2026-08-11T13:00:00'))).toContain('after the store closes')
    expect(outsideHours(DEFAULT_RULES, SUNDAY)).toBe('The store is closed on Sunday.')
  })
})

describe('mayOverrideHours', () => {
  it('lets anybody record a tow-in, because the car is already here', () => {
    expect(mayOverrideHours({ isManager: false, transportType: 'TOW_IN' }).allowed).toBe(true)
  })

  it('lets a manager through for anything else', () => {
    expect(mayOverrideHours({ isManager: true, transportType: 'WAITER' }).allowed).toBe(true)
    expect(mayOverrideHours({ isManager: false, transportType: 'WAITER' }).allowed).toBe(false)
  })

  it('does not extend the tow-in pass to a scheduled pickup', () => {
    expect(mayOverrideHours({ isManager: false, transportType: 'PICKUP_DELIVERY' }).allowed).toBe(false)
  })
})

// ----------------------------------------------------------------- load

describe('bookLoad', () => {
  const slots = slotsForDay(rules(), TUESDAY)

  it('counts one advisor per slot and across the day', () => {
    const load = bookLoad(slots, [
      appt({ at: '08:00:00' }),
      appt({ at: '08:15:00' }), // same half-hour slot
      appt({ at: '09:00:00' }),
      appt({ at: '09:30:00', advisorId: 'dana' }),
    ], 'marcus')

    expect(load.dayCount).toBe(3)
    expect(load.perSlot.get(slots[0]!.start.getTime())).toBe(2)
    expect(load.perSlot.get(slots[2]!.start.getTime())).toBe(1)
  })

  it('reads the unassigned pool as a book of its own', () => {
    const load = bookLoad(slots, [
      appt({ at: '08:00:00', advisorId: null }),
      appt({ at: '08:00:00' }),
    ], null)
    expect(load.dayCount).toBe(1)
  })

  it('still counts an appointment booked outside the grid in the day total', () => {
    // The 7am tow-in is on the book whether or not the grid has a box for it.
    const load = bookLoad(slots, [appt({ at: '07:00:00' })], 'marcus')
    expect(load.dayCount).toBe(1)
    expect(load.perSlot.size).toBe(0)
  })
})

describe('waiterLoad and countByAdvisor', () => {
  const slots = slotsForDay(rules(), TUESDAY)

  it('counts waiters across every book, because the lounge is one room', () => {
    const perSlot = waiterLoad(slots, [
      appt({ at: '08:00:00', isWaiter: true }),
      appt({ at: '08:10:00', advisorId: 'dana', isWaiter: true }),
      appt({ at: '08:20:00', isWaiter: false }),
    ])
    expect(perSlot.get(slots[0]!.start.getTime())).toBe(2)
  })

  it('ignores the pool when weighting advisors', () => {
    const counts = countByAdvisor([appt({ at: '08:00:00' }), appt({ at: '09:00:00', advisorId: null })])
    expect(counts.get('marcus')).toBe(1)
    expect(counts.size).toBe(1)
  })
})

// ------------------------------------------------------------- warnings

describe('capacityWarnings', () => {
  const slots = slotsForDay(rules(), TUESDAY)
  const slotStart = slots[0]!.start

  const base = {
    rules: rules(),
    slots,
    slotStart,
    advisorId: 'marcus' as string | null,
    advisors: ADVISORS,
    dayAppointments: [] as ScheduledAppointment[],
    isWaiter: false,
  }

  it('says nothing about a quiet morning', () => {
    expect(capacityWarnings(base)).toEqual([])
  })

  it('names the advisor, the count and the cap when a slot is full', () => {
    const said = capacityWarnings({
      ...base,
      dayAppointments: [appt({ at: '08:00:00' }), appt({ at: '08:15:00' })],
    })
    expect(said).toHaveLength(1)
    expect(said[0]).toBe('Marcus Reyes is at 2 of 2 write-ups at 8:00 AM — this would make 3.')
  })

  it('warns on the day cap as well as the slot', () => {
    const said = capacityWarnings({
      ...base,
      dayAppointments: [
        appt({ at: '08:00:00' }), appt({ at: '09:00:00' }),
        appt({ at: '10:00:00' }), appt({ at: '11:00:00' }),
      ],
    })
    expect(said.some((s) => s.includes('4 of 4 write-ups for Tuesday'))).toBe(true)
  })

  it('warns about the lounge only when this booking is a waiter', () => {
    const waiting = [
      appt({ at: '08:00:00', advisorId: 'dana', isWaiter: true }),
      appt({ at: '08:15:00', advisorId: 'dana', isWaiter: true }),
    ]
    expect(capacityWarnings({ ...base, dayAppointments: waiting, isWaiter: false }))
      .toEqual([])
    expect(capacityWarnings({ ...base, dayAppointments: waiting, isWaiter: true })
      .some((s) => s.includes('waiters are already booked'))).toBe(true)
  })

  it('says an advisor is off rather than moving the booking silently', () => {
    const said = capacityWarnings({
      ...base,
      advisors: [{ advisorId: 'marcus', name: 'Marcus Reyes', working: false }],
    })
    expect(said[0]).toContain('not on the schedule for Tuesday')
  })

  it('has nothing to say about advisor caps for the unassigned pool', () => {
    expect(capacityWarnings({
      ...base,
      advisorId: null,
      dayAppointments: [appt({ at: '08:00:00', advisorId: null }), appt({ at: '08:10:00', advisorId: null })],
    })).toEqual([])
  })

  it('does not let an appointment warn about competing with itself', () => {
    const existing = [appt({ appointmentId: 'self', at: '08:00:00' }), appt({ at: '08:15:00' })]
    expect(capacityWarnings({ ...base, dayAppointments: existing, excludeAppointmentId: 'self' }))
      .toEqual([])
  })

  it('says nothing on a closed day — that is the hard stop’s job, not a warning', () => {
    expect(capacityWarnings({ ...base, rules: DEFAULT_RULES, slotStart: SUNDAY })).toEqual([])
  })
})

// ----------------------------------------------------------- assignment

describe('assignAdvisor', () => {
  const base = { advisors: ADVISORS, dayAppointments: [] as ScheduledAppointment[], autoAssign: true }

  it('honours an explicit request above everything else', () => {
    expect(assignAdvisor({ ...base, requestedAdvisorId: 'dana', owningAdvisorId: 'marcus' }))
      .toEqual({ advisorId: 'dana', reason: 'REQUESTED' })
  })

  it('honours a request even when that advisor is off — never a silent move', () => {
    expect(assignAdvisor({
      ...base,
      advisors: [{ advisorId: 'marcus', name: 'Marcus Reyes', working: false }],
      requestedAdvisorId: 'marcus',
    })).toEqual({ advisorId: 'marcus', reason: 'REQUESTED' })
  })

  it('ignores an id that names nobody on the roster', () => {
    const decision = assignAdvisor({ ...base, requestedAdvisorId: 'departed-advisor' })
    expect(decision.reason).toBe('BALANCED')
  })

  it('falls to the owning advisor — the P3 seam, wired and unused today', () => {
    expect(assignAdvisor({ ...base, owningAdvisorId: 'marcus' }))
      .toEqual({ advisorId: 'marcus', reason: 'OWNING' })
  })

  it('balances by that day’s load, ties broken by name for determinism', () => {
    expect(assignAdvisor({ ...base, dayAppointments: [appt({ at: '08:00:00' })] }))
      .toEqual({ advisorId: 'dana', reason: 'BALANCED' })
    // Nobody booked: the tie breaks by name, and does so the same way twice.
    expect(assignAdvisor(base).advisorId).toBe('dana')
  })

  it('skips anyone who is off when balancing', () => {
    expect(assignAdvisor({
      ...base,
      advisors: [{ advisorId: 'dana', name: 'Dana Whitfield', working: false }, ADVISORS[0]!],
    }).advisorId).toBe('marcus')
  })

  it('leaves it in the pool when the store claims at arrival (Q1)', () => {
    expect(assignAdvisor({ ...base, autoAssign: false }))
      .toEqual({ advisorId: null, reason: 'CLAIMED' })
  })

  it('still lets a request through a claim-at-arrival store', () => {
    expect(assignAdvisor({ ...base, autoAssign: false, requestedAdvisorId: 'dana' }).reason)
      .toBe('REQUESTED')
  })

  it('pools the appointment when nobody at all is available', () => {
    expect(assignAdvisor({ ...base, advisors: [] }))
      .toEqual({ advisorId: null, reason: 'CLAIMED' })
  })
})

describe('assignedBy', () => {
  it('records the person when a person chose', () => {
    expect(assignedBy('REQUESTED', 'user-1')).toBe('user-1')
    expect(assignedBy('MANUAL', 'user-1')).toBe('user-1')
  })

  it('records null — not a sentinel — when a rule chose', () => {
    expect(assignedBy('BALANCED', 'user-1')).toBeNull()
    expect(assignedBy('OWNING', 'user-1')).toBeNull()
    expect(assignedBy('CLAIMED', 'user-1')).toBeNull()
  })
})
