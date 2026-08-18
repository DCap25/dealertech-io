import { describe, expect, it } from 'vitest'
import {
  applyCoverageScenario, emptyBundle, isCoverageScenario, lastServiceMileageByGroup,
  toContract, toInspectionSnapshots, toPrepaidEntitlement, toPrepSheetInputs,
} from './index'
import type {
  DmsAppointment, DmsCoverage, DmsCustomer, DmsDriveBundle, DmsInspection, DmsServiceLine,
  DmsVehicle,
} from './types'

const ASOF = new Date('2026-08-12T12:00:00Z')

function customer(over: Partial<DmsCustomer> = {}): DmsCustomer {
  return {
    id: 'c1',
    firstName: 'Maria',
    lastName: 'Perez',
    companyName: null,
    phone: '5125550142',
    email: null,
    preferredChannel: 'SMS',
    doNotCall: false,
    smsConsent: true,
    visitCount: 6,
    lifetimeSpend: 1412,
    lastVisitAt: null,
    ...over,
  }
}

function vehicle(over: Partial<DmsVehicle> = {}): DmsVehicle {
  return {
    id: 'v1',
    customerId: 'c1',
    vin: '5NP8BCFL4M04TB0CT',
    make: 'HYUNDAI',
    model: 'Tucson',
    modelYear: 2021,
    trim: null,
    licensePlate: null,
    inServiceDate: new Date('2021-08-05T12:00:00Z'),
    currentMileage: 51_140,
    avgMilesPerDay: 28,
    isHybridOrEv: false,
    isFullyElectric: false,
    driveType: null,
    isOriginalOwner: true,
    ...over,
  }
}

function appointment(over: Partial<DmsAppointment> = {}): DmsAppointment {
  return {
    id: 'a1',
    customerId: 'c1',
    vehicleId: 'v1',
    advisorId: 'u1',
    advisorName: 'Marcus Reyes',
    scheduledAt: new Date('2026-08-12T14:00:00Z'),
    promisedAt: null,
    transportType: 'WAITER',
    status: 'SCHEDULED',
    customerConcerns: 'Noise from front end over bumps',
    ...over,
  }
}

function coverage(over: Partial<DmsCoverage> = {}): DmsCoverage {
  return {
    id: 'k1',
    vehicleId: 'v1',
    customerId: 'c1',
    productType: 'VSC',
    adminCompany: 'Endurance',
    contractNumber: 'VSC-1',
    purchaseDate: new Date('2024-01-01T12:00:00Z'),
    purchaseMileage: 20_000,
    termMonths: 60,
    termMiles: 75_000,
    expirationDate: new Date('2029-01-01T12:00:00Z'),
    expirationMiles: 95_000,
    deductibleAmount: 100,
    deductibleType: 'PER_VISIT',
    coverageTier: 'Platinum',
    tierType: 'EXCLUSIONARY',
    coveredComponentGroups: [],
    excludedComponentGroups: [],
    requiresPriorAuthorization: true,
    claimPhone: '(800) 555-0142',
    status: 'ACTIVE',
    minimumTreadDepth32nds: null,
    perTireLimit: null,
    source: 'DMS_FEED',
    verifiedAt: null,
    ...over,
  }
}

function bundle(over: Partial<DmsDriveBundle> = {}): DmsDriveBundle {
  return {
    ...emptyBundle(),
    appointments: [appointment()],
    customers: [customer()],
    vehicles: [vehicle()],
    ...over,
  }
}

describe('toContract', () => {
  it('carries the fields the coverage engine arbitrates on', () => {
    const c = toContract(coverage())
    expect(c.productType).toBe('VSC')
    expect(c.deductibleAmount).toBe(100)
    expect(c.tierType).toBe('EXCLUSIONARY')
    expect(c.requiresPriorAuthorization).toBe(true)
  })

  it('treats cancelled and lapsed alike as expired', () => {
    // They differ commercially, but not for "who pays for this repair today".
    expect(toContract(coverage({ status: 'CANCELLED' })).status).toBe('EXPIRED')
    expect(toContract(coverage({ status: 'EXPIRED' })).status).toBe('EXPIRED')
    expect(toContract(coverage({ status: 'ACTIVE' })).status).toBe('ACTIVE')
  })

  it('keeps empty component lists empty rather than guessing', () => {
    // Filling these with guesses turns "we don't know" into a confident wrong
    // answer about who pays.
    const c = toContract(coverage())
    expect(c.coveredComponentGroups).toEqual([])
    expect(c.excludedComponentGroups).toEqual([])
  })

  it('converts absent optionals to undefined, not null', () => {
    const c = toContract(coverage({ contractNumber: null, expirationDate: null }))
    expect(c.contractNumber).toBeUndefined()
    expect(c.expirationDate).toBeUndefined()
  })
})

describe('toPrepaidEntitlement', () => {
  it('preserves the visit counts the engine reasons about', () => {
    const e = toPrepaidEntitlement({
      vehicleId: 'v1',
      contractId: 'k1',
      componentGroupKey: 'OIL_CHANGE',
      label: 'Prepaid Oil Change',
      totalAllowed: 6,
      used: 3,
      expiresOn: new Date('2026-10-01T12:00:00Z'),
    })
    expect(e.totalAllowed).toBe(6)
    expect(e.used).toBe(3)
    expect(e.label).toBe('Prepaid Oil Change')
  })
})

describe('toInspectionSnapshots', () => {
  const inspection = (over: Partial<DmsInspection> = {}): DmsInspection => ({
    id: 'i1',
    vehicleId: 'v1',
    mileage: 33_290,
    recordedAt: new Date('2026-01-10T12:00:00Z'),
    items: [
      { itemKey: 'TIRE_RF', componentGroupKey: 'TIRES', value: 4, unit: 'THIRTY_SECONDS', position: 'RF' },
    ],
    ...over,
  })

  it('drops inspections with no odometer', () => {
    // Wear prediction fits value against mileage; a reading with no mileage
    // cannot contribute a slope and would silently skew the fit.
    expect(toInspectionSnapshots([inspection({ mileage: null })])).toEqual([])
  })

  it('keeps measurements and positions intact', () => {
    const [snapshot] = toInspectionSnapshots([inspection()])
    expect(snapshot?.mileage).toBe(33_290)
    expect(snapshot?.items[0]?.position).toBe('RF')
    expect(snapshot?.items[0]?.value).toBe(4)
  })
})

describe('lastServiceMileageByGroup', () => {
  const line = (over: Partial<DmsServiceLine> = {}): DmsServiceLine => ({
    repairOrderId: 'ro1',
    vehicleId: 'v1',
    componentGroupKey: 'OIL_CHANGE',
    description: 'Oil & filter',
    mileage: 30_000,
    closedAt: new Date('2026-01-10T12:00:00Z'),
    payType: 'CUSTOMER_PAY',
    amount: 84,
    customerAmount: 84,
    ...over,
  })

  it('takes the highest odometer, not the latest date', () => {
    // A back-dated RO would otherwise pull the figure backwards and make an
    // interval look due when it is not.
    const result = lastServiceMileageByGroup([
      line({ mileage: 40_000, closedAt: new Date('2026-01-01T12:00:00Z') }),
      line({ mileage: 30_000, closedAt: new Date('2026-06-01T12:00:00Z') }),
    ])
    expect(result.OIL_CHANGE).toBe(40_000)
  })

  it('ignores lines with no group or no mileage', () => {
    expect(lastServiceMileageByGroup([
      line({ componentGroupKey: null }),
      line({ mileage: null }),
    ])).toEqual({})
  })
})

describe('toPrepSheetInputs', () => {
  const store = { state: 'TX', laborRate: 185 }

  it('builds one input per appointment', () => {
    const inputs = toPrepSheetInputs(bundle(), store, ASOF)
    expect(inputs).toHaveLength(1)
    expect(inputs[0]?.customer.name).toBe('Maria Perez')
    expect(inputs[0]?.vehicle.vin).toBe('5NP8BCFL4M04TB0CT')
  })

  it('drops an appointment with no vehicle or customer rather than faking one', () => {
    // Real DMS days contain these: a walk-in keyed before the VIN was decoded,
    // a cancelled booking. There is no honest prep sheet to build from one.
    expect(toPrepSheetInputs(bundle({
      appointments: [appointment({ vehicleId: null })],
    }), store, ASOF)).toHaveLength(0)

    expect(toPrepSheetInputs(bundle({
      appointments: [appointment({ customerId: null })],
    }), store, ASOF)).toHaveLength(0)
  })

  it('carries the delivery introduction through to the sheet', () => {
    /*
      The prep sheet is built only from mapped bundles, so a field the mapper
      drops is a field the drive cannot render — which is exactly how advisorId
      and status went missing until P1. The first-service cue reads all three.
    */
    const inputs = toPrepSheetInputs(bundle({
      appointments: [appointment({
        visitContext: 'FIRST_SERVICE',
        soldByName: 'Elena Vasquez',
        introducedAdvisorName: 'Dana Whitfield',
      })],
    }), store, ASOF)

    expect(inputs[0]?.appointment?.visitContext).toBe('FIRST_SERVICE')
    expect(inputs[0]?.appointment?.soldByName).toBe('Elena Vasquez')
    expect(inputs[0]?.appointment?.introducedAdvisorName).toBe('Dana Whitfield')
  })

  it('answers null for a DMS that was not standing there at delivery', () => {
    // A real integration knows nothing about a salesperson walking somebody
    // over, and null is the correct answer rather than a gap.
    const inputs = toPrepSheetInputs(bundle(), store, ASOF)
    expect(inputs[0]?.appointment?.visitContext).toBeNull()
    expect(inputs[0]?.appointment?.soldByName).toBeNull()
  })

  it('falls back to the company name for a fleet customer', () => {
    const inputs = toPrepSheetInputs(bundle({
      customers: [customer({ firstName: null, lastName: null, companyName: 'Bluebonnet Plumbing' })],
    }), store, ASOF)
    expect(inputs[0]?.customer.name).toBe('Bluebonnet Plumbing')
  })

  it('never leaves the name blank', () => {
    const inputs = toPrepSheetInputs(bundle({
      customers: [customer({ firstName: null, lastName: null, companyName: null })],
    }), store, ASOF)
    expect(inputs[0]?.customer.name).toBe('Unknown')
  })

  it('routes coverage to the right vehicle only', () => {
    const inputs = toPrepSheetInputs(bundle({
      coverages: [coverage({ vehicleId: 'v1' }), coverage({ id: 'k2', vehicleId: 'other' })],
    }), store, ASOF)
    expect(inputs[0]?.contracts).toHaveLength(1)
    expect(inputs[0]?.contracts[0]?.id).toBe('k1')
  })

  it('excludes declines that were already resolved', () => {
    const inputs = toPrepSheetInputs(bundle({
      declinedServices: [
        {
          id: 'd1', vehicleId: 'v1', customerId: 'c1', description: 'Alignment',
          componentGroupKey: 'WHEEL_ALIGNMENT', quotedAmount: 149,
          declinedAt: new Date('2026-01-10T12:00:00Z'), mileageAtDecline: 33_290,
          resolvedAt: new Date('2026-03-01T12:00:00Z'),
        },
      ],
    }), store, ASOF)
    expect(inputs[0]?.openDeclines).toHaveLength(0)
  })

  it('keeps only pinned notes', () => {
    const inputs = toPrepSheetInputs(bundle({
      customerNotes: [
        { customerId: 'c1', body: 'Prefers morning appointments', isPinned: true },
        { customerId: 'c1', body: 'Routine chatter', isPinned: false },
      ],
    }), store, ASOF)
    expect(inputs[0]?.customer.pinnedNotes).toEqual(['Prefers morning appointments'])
  })

  it('passes the original-owner flag through untouched', () => {
    // Several OEM powertrain terms are original-owner-only. A wrong value here
    // changes who pays.
    const second = toPrepSheetInputs(bundle({
      vehicles: [vehicle({ isOriginalOwner: false })],
    }), store, ASOF)
    expect(second[0]?.vehicle.isOriginalOwner).toBe(false)
  })

  it('defaults a missing odometer to zero rather than crashing', () => {
    const inputs = toPrepSheetInputs(bundle({
      vehicles: [vehicle({ currentMileage: null })],
    }), store, ASOF)
    expect(inputs[0]?.vehicle.currentMileage).toBe(0)
  })

  describe('when the bundle contradicts its own odometer', () => {
    const stale = (over: Partial<DmsDriveBundle> = {}) => bundle({
      vehicles: [vehicle({ currentMileage: 50_000 })],
      ...over,
    })

    const inspectionAt = (mileage: number): DmsInspection => ({
      id: 'i1', vehicleId: 'v1', mileage,
      recordedAt: new Date('2026-07-04T12:00:00Z'), items: [],
    })

    const lineAt = (mileage: number): DmsServiceLine => ({
      repairOrderId: 'r1', vehicleId: 'v1', componentGroupKey: 'OIL_CHANGE',
      description: 'Lube, Oil & Filter', mileage,
      closedAt: new Date('2026-06-01T12:00:00Z'),
      payType: 'CUSTOMER_PAY', amount: 84, customerAmount: 84,
    })

    it('works from the higher figure the payload itself proves', () => {
      // A vehicle record at 50,000 arriving with an inspection taken at
      // 92,000. Trusting the record would leave mileage-based warranty
      // looking live when it expired 42,000 miles ago.
      const inputs = toPrepSheetInputs(stale({ inspections: [inspectionAt(92_000)] }), store, ASOF)
      expect(inputs[0]?.vehicle.currentMileage).toBe(92_000)
    })

    it('takes closed repair orders and old declines as evidence too', () => {
      const fromLine = toPrepSheetInputs(stale({ serviceLines: [lineAt(88_000)] }), store, ASOF)
      expect(fromLine[0]?.vehicle.currentMileage).toBe(88_000)
    })

    it('says so rather than correcting it quietly', () => {
      // An import has nobody to ask, so the one case this gets wrong — a
      // genuinely replaced cluster — has to reach someone who can look at it.
      const inputs = toPrepSheetInputs(stale({ inspections: [inspectionAt(92_000)] }), store, ASOF)
      expect(inputs[0]?.odometerNote).toContain('50,000')
      expect(inputs[0]?.odometerNote).toContain('92,000')
    })

    it('stays quiet when the vehicle record is the highest figure', () => {
      const inputs = toPrepSheetInputs(
        bundle({ inspections: [inspectionAt(33_290)] }), store, ASOF,
      )
      expect(inputs[0]?.odometerNote).toBeUndefined()
    })

    it('does not borrow another vehicle’s odometer', () => {
      // The evidence is indexed per vehicle. A high reading on the customer's
      // other car must not raise this one's odometer.
      const inputs = toPrepSheetInputs(stale({
        inspections: [{ ...inspectionAt(92_000), vehicleId: 'v2' }],
      }), store, ASOF)
      expect(inputs[0]?.vehicle.currentMileage).toBe(50_000)
      expect(inputs[0]?.odometerNote).toBeUndefined()
    })
  })

  it('returns nothing for an empty bundle', () => {
    expect(toPrepSheetInputs(emptyBundle(), store, ASOF)).toEqual([])
  })
})

describe('coverage scenarios', () => {
  it('leaves the seed alone for AS_SEEDED', () => {
    const seeded = bundle({ coverages: [coverage()] })
    expect(applyCoverageScenario(seeded, 'AS_SEEDED', ASOF)).toBe(seeded)
  })

  it('replaces rather than appends, so NO_COVERAGE means none', () => {
    const result = applyCoverageScenario(bundle({ coverages: [coverage()] }), 'NO_COVERAGE', ASOF)
    expect(result.coverages).toEqual([])
    expect(result.prepaidEntitlements).toEqual([])
  })

  it('gives every vehicle an active service contract', () => {
    const result = applyCoverageScenario(bundle(), 'ACTIVE_VSC', ASOF)
    expect(result.coverages).toHaveLength(1)
    expect(result.coverages[0]?.productType).toBe('VSC')
    expect(result.coverages[0]?.status).toBe('ACTIVE')
  })

  it('makes the prepaid plan genuinely close to expiring with visits left', () => {
    const result = applyCoverageScenario(bundle(), 'EXPIRING_PPM', ASOF)
    const entitlement = result.prepaidEntitlements[0]!
    expect(entitlement.totalAllowed - entitlement.used).toBeGreaterThan(0)
    expect(entitlement.expiresOn!.getTime()).toBeGreaterThan(ASOF.getTime())
    expect(entitlement.expiresOn!.getTime()).toBeLessThan(ASOF.getTime() + 90 * 86_400_000)
  })

  it('gives tire & wheel a tread minimum, because road hazard products have one', () => {
    const result = applyCoverageScenario(bundle(), 'TIRE_AND_WHEEL', ASOF)
    expect(result.coverages[0]?.productType).toBe('TIRE_WHEEL')
    expect(result.coverages[0]?.minimumTreadDepth32nds).toBeGreaterThan(0)
  })

  it('stacks three products for FULL_STACK', () => {
    const result = applyCoverageScenario(bundle(), 'FULL_STACK', ASOF)
    expect(result.coverages.map((c) => c.productType).sort()).toEqual(['PPM', 'TIRE_WHEEL', 'VSC'])
  })

  it('applies to every vehicle in the bundle', () => {
    const two = bundle({ vehicles: [vehicle(), vehicle({ id: 'v2' })] })
    expect(applyCoverageScenario(two, 'ACTIVE_VSC', ASOF).coverages).toHaveLength(2)
  })

  it('produces contracts the engine mapping accepts', () => {
    const result = applyCoverageScenario(bundle(), 'FULL_STACK', ASOF)
    for (const c of result.coverages) {
      expect(() => toContract(c)).not.toThrow()
    }
  })

  it('validates scenario names from the environment', () => {
    expect(isCoverageScenario('ACTIVE_VSC')).toBe(true)
    expect(isCoverageScenario('nonsense')).toBe(false)
    expect(isCoverageScenario(undefined)).toBe(false)
  })
})

