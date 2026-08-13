import { describe, it, expect } from 'vitest'
import { generateCadenceTasks } from './generate'
import type { CadenceContext, CadenceRule, CadenceVehicle } from './types'

const NOW = new Date('2026-08-12T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 86_400_000)

function rule(overrides: Partial<CadenceRule> & Pick<CadenceRule, 'trigger'>): CadenceRule {
  return {
    id: `rule-${overrides.trigger}`,
    name: overrides.trigger,
    offsetDays: 0,
    offsetMiles: null,
    assignToRole: 'BDC',
    talkTrack: null,
    cooldownDays: 30,
    priority: 100,
    isActive: true,
    ...overrides,
  }
}

function vehicle(overrides: Partial<CadenceVehicle> = {}): CadenceVehicle {
  return {
    id: 'v1', make: 'FORD', model: 'F-150', modelYear: 2021,
    vin: '1FTFW1ET9DFC10312',
    inServiceDate: new Date('2021-05-01T12:00:00Z'),
    currentMileage: 62_000, avgMilesPerDay: 32,
    isHybridOrEv: false, isOriginalOwner: true,
    contracts: [], prepaidEntitlements: [], openDeclines: [], openRecalls: [],
    lastServiceMileageByGroup: {},
    nextAppointmentAt: null,
    ...overrides,
  }
}

function context(overrides: Partial<CadenceContext> = {}): CadenceContext {
  return {
    asOf: NOW,
    lookaheadDays: 7,
    store: { state: 'TX', laborRate: 185 },
    customer: {
      id: 'c1', name: 'Maria Garcia', visitCount: 6, lifetimeSpend: 3600,
      lastVisitAt: daysAgo(10), lastRoClosedAt: daysAgo(10),
      doNotCall: false, smsConsent: true, emailConsent: true, preferredChannel: 'SMS',
    },
    vehicles: [vehicle()],
    rules: [],
    existingTasks: [],
    ...overrides,
  }
}

describe('do-not-call', () => {
  it('suppresses the entire worklist, not just one rule', () => {
    // A customer who asked not to be contacted must not reappear because some
    // other trigger happened to fire.
    const tasks = generateCadenceTasks(context({
      customer: { ...context().customer, doNotCall: true },
      rules: [
        rule({ trigger: 'POST_VISIT_THANK_YOU', offsetDays: 2 }),
        rule({ trigger: 'DORMANT_CUSTOMER', offsetDays: 1 }),
      ],
      vehicles: [vehicle({ openDeclines: [{ id: 'd1', description: 'Brakes', componentGroupKey: 'BRAKE_PADS_SHOES', quotedAmount: 618, declinedAt: daysAgo(20) }] })],
    }))
    expect(tasks).toEqual([])
  })
})

describe('declined service re-offer', () => {
  const decline = {
    id: 'd1', description: 'Front Brake Pads & Rotors',
    componentGroupKey: 'BRAKE_PADS_SHOES', quotedAmount: 618, declinedAt: daysAgo(12),
  }

  it('produces a task once the offset has elapsed', () => {
    const tasks = generateCadenceTasks(context({
      rules: [rule({ trigger: 'DECLINED_SERVICE_FOLLOW_UP', offsetDays: 10 })],
      vehicles: [vehicle({ openDeclines: [decline] })],
    }))
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.title).toBe('Re-offer: Front Brake Pads & Rotors')
    expect(tasks[0]?.estimatedValue).toBe(618)
    expect(tasks[0]?.sourceDeclinedServiceId).toBe('d1')
  })

  it('stays quiet until the offset has elapsed', () => {
    const tasks = generateCadenceTasks(context({
      rules: [rule({ trigger: 'DECLINED_SERVICE_FOLLOW_UP', offsetDays: 40 })],
      vehicles: [vehicle({ openDeclines: [decline] })],
    }))
    expect(tasks).toHaveLength(0)
  })

  it('chases two different declined lines independently', () => {
    const tasks = generateCadenceTasks(context({
      rules: [rule({ trigger: 'DECLINED_SERVICE_FOLLOW_UP', offsetDays: 10 })],
      vehicles: [vehicle({
        openDeclines: [decline, { ...decline, id: 'd2', description: 'Four Tires', quotedAmount: 1100 }],
      })],
    }))
    expect(tasks).toHaveLength(2)
    // Highest value first, so a rep working top-down takes the best call.
    expect(tasks[0]?.estimatedValue).toBe(1100)
  })

  it('does not chase the same line twice inside the cooldown', () => {
    const tasks = generateCadenceTasks(context({
      rules: [rule({ trigger: 'DECLINED_SERVICE_FOLLOW_UP', offsetDays: 10, cooldownDays: 45 })],
      vehicles: [vehicle({ openDeclines: [decline] })],
      existingTasks: [{
        cadenceRuleId: 'rule-DECLINED_SERVICE_FOLLOW_UP', customerId: 'c1', vehicleId: 'v1',
        sourceKey: 'decline:d1', createdAt: daysAgo(5), status: 'COMPLETED',
      }],
    }))
    expect(tasks).toHaveLength(0)
  })

  it('chases again once the cooldown has passed', () => {
    const tasks = generateCadenceTasks(context({
      rules: [rule({ trigger: 'DECLINED_SERVICE_FOLLOW_UP', offsetDays: 10, cooldownDays: 30 })],
      vehicles: [vehicle({ openDeclines: [decline] })],
      existingTasks: [{
        cadenceRuleId: 'rule-DECLINED_SERVICE_FOLLOW_UP', customerId: 'c1', vehicleId: 'v1',
        sourceKey: 'decline:d1', createdAt: daysAgo(60), status: 'COMPLETED',
      }],
    }))
    expect(tasks).toHaveLength(1)
  })

  it('never duplicates a task that is still open, however old', () => {
    const tasks = generateCadenceTasks(context({
      rules: [rule({ trigger: 'DECLINED_SERVICE_FOLLOW_UP', offsetDays: 10, cooldownDays: 1 })],
      vehicles: [vehicle({ openDeclines: [decline] })],
      existingTasks: [{
        cadenceRuleId: 'rule-DECLINED_SERVICE_FOLLOW_UP', customerId: 'c1', vehicleId: 'v1',
        sourceKey: 'decline:d1', createdAt: daysAgo(200), status: 'PENDING',
      }],
    }))
    expect(tasks).toHaveLength(0)
  })
})

describe('prepaid plan expiring', () => {
  const entitlement = {
    contractId: 'ppm1', componentGroupKey: 'OIL_CHANGE', label: 'Oil Change',
    totalAllowed: 5, used: 2, expiresOn: daysAhead(40),
  }

  it('fires ahead of expiry using a negative offset', () => {
    const tasks = generateCadenceTasks(context({
      rules: [rule({ trigger: 'PPM_EXPIRING', offsetDays: -45 })],
      vehicles: [vehicle({ prepaidEntitlements: [entitlement] })],
    }))
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.title).toContain('3 prepaid')
    expect(tasks[0]?.detail).toContain('40 days')
    // Three unused visits are worth something concrete.
    expect(tasks[0]?.estimatedValue).toBeGreaterThan(0)
  })

  it('ignores a plan with nothing left on it', () => {
    const tasks = generateCadenceTasks(context({
      rules: [rule({ trigger: 'PPM_EXPIRING', offsetDays: -45 })],
      vehicles: [vehicle({ prepaidEntitlements: [{ ...entitlement, used: 5 }] })],
    }))
    expect(tasks).toHaveLength(0)
  })

  it('ignores a plan that has already expired', () => {
    const tasks = generateCadenceTasks(context({
      rules: [rule({ trigger: 'PPM_EXPIRING', offsetDays: -45 })],
      vehicles: [vehicle({ prepaidEntitlements: [{ ...entitlement, expiresOn: daysAgo(5) }] })],
    }))
    expect(tasks).toHaveLength(0)
  })
})

describe('maintenance due', () => {
  it('projects the due date from how fast they actually drive', () => {
    const tasks = generateCadenceTasks(context({
      rules: [rule({ trigger: 'MAINTENANCE_DUE_MILEAGE', offsetMiles: 500 })],
      vehicles: [vehicle({
        currentMileage: 62_300,
        lastServiceMileageByGroup: { OIL_CHANGE: 55_000 }, // due at 62,500
      })],
    }))
    const oil = tasks.find((t) => t.title.includes('Oil'))
    expect(oil).toBeDefined()
    expect(oil?.detail).toContain('62,500')
  })

  it('refuses to guess when there is no service history', () => {
    // Recommending an interval we have no record of damages trust.
    const tasks = generateCadenceTasks(context({
      rules: [rule({ trigger: 'MAINTENANCE_DUE_MILEAGE', offsetMiles: 500 })],
      vehicles: [vehicle({ currentMileage: 120_000, lastServiceMileageByGroup: {} })],
    }))
    expect(tasks).toHaveLength(0)
  })

  it('does not call to book a visit that is already booked', () => {
    const tasks = generateCadenceTasks(context({
      rules: [rule({ trigger: 'MAINTENANCE_DUE_MILEAGE', offsetMiles: 500 })],
      vehicles: [vehicle({
        currentMileage: 62_300,
        lastServiceMileageByGroup: { OIL_CHANGE: 55_000 },
        nextAppointmentAt: daysAhead(3),
      })],
    }))
    expect(tasks).toHaveLength(0)
  })

  it('flags overdue maintenance in plain terms', () => {
    const tasks = generateCadenceTasks(context({
      rules: [rule({ trigger: 'MAINTENANCE_DUE_MILEAGE', offsetMiles: 500 })],
      vehicles: [vehicle({
        currentMileage: 66_000,
        lastServiceMileageByGroup: { OIL_CHANGE: 55_000 },
      })],
    }))
    expect(tasks[0]?.detail).toMatch(/Overdue by 3,500 miles/)
  })
})

describe('warranty expiring', () => {
  const closing = vehicle({
    modelYear: 2023, inServiceDate: new Date('2023-09-01T12:00:00Z'), currentMileage: 33_000,
  })

  it('opens the service contract window before coverage lapses', () => {
    const tasks = generateCadenceTasks(context({
      rules: [rule({ trigger: 'WARRANTY_EXPIRING', offsetDays: -90 })],
      vehicles: [closing],
    }))
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.estimatedValue).toBe(2400)
  })

  it('stays quiet when they already own a contract', () => {
    const tasks = generateCadenceTasks(context({
      rules: [rule({ trigger: 'WARRANTY_EXPIRING', offsetDays: -90 })],
      vehicles: [{
        ...closing,
        contracts: [{
          id: 'vsc1', productType: 'VSC', adminCompany: 'Zurich',
          purchaseDate: new Date('2023-09-01T12:00:00Z'), termMonths: 84, termMiles: 100_000,
          deductibleAmount: 100, deductibleType: 'PER_VISIT', tierType: 'EXCLUSIONARY',
          coveredComponentGroups: [], excludedComponentGroups: [],
          requiresPriorAuthorization: true, status: 'ACTIVE', source: 'MANUAL',
        }],
      }],
    }))
    expect(tasks).toHaveLength(0)
  })
})

describe('dormant customer recovery', () => {
  it('surfaces a customer who has gone quiet', () => {
    const tasks = generateCadenceTasks(context({
      customer: {
        ...context().customer,
        lastVisitAt: daysAgo(500), lastRoClosedAt: daysAgo(500),
        visitCount: 8, lifetimeSpend: 4800,
      },
      rules: [rule({ trigger: 'DORMANT_CUSTOMER', offsetDays: 400 })],
    }))
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.detail).toContain('17 months')
    // Worth roughly one average visit.
    expect(tasks[0]?.estimatedValue).toBe(600)
  })

  it('leaves an active customer alone', () => {
    const tasks = generateCadenceTasks(context({
      rules: [rule({ trigger: 'DORMANT_CUSTOMER', offsetDays: 400 })],
    }))
    expect(tasks).toHaveLength(0)
  })

  it('does not chase someone who already has an appointment booked', () => {
    const tasks = generateCadenceTasks(context({
      customer: { ...context().customer, lastVisitAt: daysAgo(500), lastRoClosedAt: daysAgo(500) },
      rules: [rule({ trigger: 'DORMANT_CUSTOMER', offsetDays: 400 })],
      vehicles: [vehicle({ nextAppointmentAt: daysAhead(2) })],
    }))
    expect(tasks).toHaveLength(0)
  })
})

describe('post-visit follow up', () => {
  it('fires a thank-you at the configured offset', () => {
    const tasks = generateCadenceTasks(context({
      customer: { ...context().customer, lastRoClosedAt: daysAgo(2) },
      rules: [rule({ trigger: 'POST_VISIT_THANK_YOU', offsetDays: 2 })],
    }))
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.estimatedValue).toBe(0)
  })

  it('does not chase a visit from months ago', () => {
    const tasks = generateCadenceTasks(context({
      customer: { ...context().customer, lastRoClosedAt: daysAgo(120) },
      rules: [rule({ trigger: 'POST_VISIT_THANK_YOU', offsetDays: 2 })],
    }))
    expect(tasks).toHaveLength(0)
  })
})

describe('worklist shape', () => {
  it('honours the lookahead so the list stays actionable', () => {
    const tasks = generateCadenceTasks(context({
      lookaheadDays: 3,
      rules: [rule({ trigger: 'PPM_EXPIRING', offsetDays: -10 })],
      // Expires in 40 days, so the task is due in 30 — beyond a 3-day lookahead.
      vehicles: [vehicle({ prepaidEntitlements: [{
        contractId: 'p1', componentGroupKey: 'OIL_CHANGE', label: 'Oil Change',
        totalAllowed: 5, used: 1, expiresOn: daysAhead(40),
      }] })],
    }))
    expect(tasks).toHaveLength(0)
  })

  it('orders by rule priority first, then by value', () => {
    const tasks = generateCadenceTasks(context({
      rules: [
        rule({ trigger: 'DECLINED_SERVICE_FOLLOW_UP', offsetDays: 10, priority: 50 }),
        rule({ trigger: 'POST_VISIT_THANK_YOU', offsetDays: 2, priority: 10 }),
      ],
      customer: { ...context().customer, lastRoClosedAt: daysAgo(2) },
      vehicles: [vehicle({ openDeclines: [{
        id: 'd1', description: 'Tires', componentGroupKey: 'TIRES',
        quotedAmount: 1100, declinedAt: daysAgo(12),
      }] })],
    }))
    // Priority 10 outranks priority 50 even though it is worth nothing.
    expect(tasks[0]?.trigger).toBe('POST_VISIT_THANK_YOU')
    expect(tasks[1]?.trigger).toBe('DECLINED_SERVICE_FOLLOW_UP')
  })

  it('produces one card per decline even when several touches are configured', () => {
    // A 10-day and a 40-day re-offer both elapse on a six-month-old decline.
    // The rep should see one card, not two identical ones.
    const tasks = generateCadenceTasks(context({
      rules: [
        rule({ id: 'first', trigger: 'DECLINED_SERVICE_FOLLOW_UP', offsetDays: 10, priority: 100 }),
        rule({ id: 'second', trigger: 'DECLINED_SERVICE_FOLLOW_UP', offsetDays: 40, priority: 100 }),
      ],
      vehicles: [vehicle({ openDeclines: [{
        id: 'd1', description: 'Brakes', componentGroupKey: 'BRAKE_PADS_SHOES',
        quotedAmount: 618, declinedAt: daysAgo(180),
      }] })],
    }))
    expect(tasks).toHaveLength(1)
    // On a tie, the later touch wins — it is the more recent step in the sequence.
    expect(tasks[0]?.cadenceRuleId).toBe('second')
  })

  it('is idempotent when sibling touches collapsed on a previous run', () => {
    // Run one stored the card under the 40-day rule. Run two must not fire the
    // 10-day rule for the same decline just because no card carries its id.
    const rules = [
      rule({ id: 'first', trigger: 'DECLINED_SERVICE_FOLLOW_UP', offsetDays: 10 }),
      rule({ id: 'second', trigger: 'DECLINED_SERVICE_FOLLOW_UP', offsetDays: 40 }),
    ]
    const vehicles = [vehicle({ openDeclines: [{
      id: 'd1', description: 'Brakes', componentGroupKey: 'BRAKE_PADS_SHOES',
      quotedAmount: 618, declinedAt: daysAgo(180),
    }] })]

    const tasks = generateCadenceTasks(context({
      rules,
      vehicles,
      existingTasks: [{
        cadenceRuleId: 'second', customerId: 'c1', vehicleId: 'v1',
        sourceKey: 'decline:d1', createdAt: daysAgo(0), status: 'PENDING',
      }],
    }))
    expect(tasks).toHaveLength(0)
  })

  it('keeps separate cards for separate declines', () => {
    const tasks = generateCadenceTasks(context({
      rules: [
        rule({ id: 'first', trigger: 'DECLINED_SERVICE_FOLLOW_UP', offsetDays: 10 }),
        rule({ id: 'second', trigger: 'DECLINED_SERVICE_FOLLOW_UP', offsetDays: 40 }),
      ],
      vehicles: [vehicle({ openDeclines: [
        { id: 'd1', description: 'Brakes', componentGroupKey: 'BRAKE_PADS_SHOES', quotedAmount: 618, declinedAt: daysAgo(180) },
        { id: 'd2', description: 'Tires', componentGroupKey: 'TIRES', quotedAmount: 1100, declinedAt: daysAgo(180) },
      ] })],
    }))
    expect(tasks).toHaveLength(2)
  })

  it('ignores inactive rules', () => {
    const tasks = generateCadenceTasks(context({
      rules: [rule({ trigger: 'POST_VISIT_THANK_YOU', offsetDays: 2, isActive: false })],
      customer: { ...context().customer, lastRoClosedAt: daysAgo(2) },
    }))
    expect(tasks).toHaveLength(0)
  })
})
