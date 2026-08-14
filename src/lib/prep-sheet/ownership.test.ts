import { describe, expect, it } from 'vitest'
import { ownershipHint, summarizeOwnership, toOwnedKind } from './ownership'
import type { Contract } from '@/lib/coverage'
import type { Opportunity, PrepSheet } from './types'
import type { TermStatus } from '@/lib/warranty'

const ASOF = new Date('2026-08-12T12:00:00Z')

function contract(over: Partial<Contract> = {}): Contract {
  return {
    id: 'k1',
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
    requiresPriorAuthorization: false,
    claimPhone: '(800) 555-0142',
    status: 'ACTIVE',
    source: 'DMS_FEED',
    ...over,
  } as Contract
}

function term(): TermStatus {
  return {
    name: 'Basic', term: { months: 36, miles: 36000 }, active: false,
    monthsRemaining: 0, milesRemaining: 0, expiresOn: null, expiresAtMiles: null,
    limitingFactor: 'TIME', expiredBy: 'TIME',
  }
}

function sheet(over: Partial<PrepSheet> = {}): PrepSheet {
  return {
    customer: {
      id: 'c1', name: 'Maria Perez', visitCount: 6, lifetimeSpend: 1412,
      lastVisitAt: null, preferredChannel: 'SMS', pinnedNotes: [],
    },
    vehicle: {
      id: 'v1', vin: '5NP8BCFL4M04TB0CT', make: 'HYUNDAI', model: 'Tucson', modelYear: 2021,
      inServiceDate: null, currentMileage: 51_140, avgMilesPerDay: 28,
      isHybridOrEv: false, isOriginalOwner: true,
    },
    appointment: undefined,
    warranty: {
      make: 'HYUNDAI', modelYear: 2021, known: true, program: undefined,
      basic: null, powertrain: null, corrosion: null,
      emissionsLong: term(), emissionsShort: term(), hybridEv: null, warnings: [],
    },
    contracts: [],
    prepaidEntitlements: [],
    inspectionHistory: [],
    projectedMileage: 51_140,
    opportunities: [],
    totals: { opportunityValue: 0, customerOutOfPocket: 0, coveredValue: 0 },
    alerts: [],
    ...over,
  }
}

function opportunity(over: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'o1',
    type: 'WEAR_PREDICTED',
    title: 'Tires approaching replacement',
    detail: 'Worst corner RF at 4/32".',
    componentGroupKey: 'TIRES',
    estimatedAmount: 1100,
    customerOutOfPocket: 1100,
    likelyPayer: 'CUSTOMER_PAY',
    urgency: 'HIGH',
    closeProbability: 0.5,
    priorityScore: 80,
    talkTrack: 'Show the trend.',
    ...over,
  }
}

describe('toOwnedKind', () => {
  it('normalises the two vocabularies for dent protection', () => {
    // The DMS layer says PDR, the seed says DENT. Same product.
    expect(toOwnedKind('PDR')).toBe('PDR')
    expect(toOwnedKind('DENT')).toBe('PDR')
  })

  it('falls back rather than throwing on an unmapped product', () => {
    expect(toOwnedKind('SOMETHING_NEW')).toBe('OTHER')
  })
})

describe('summarizeOwnership', () => {
  it('says plainly when nothing is on file', () => {
    const summary = summarizeOwnership(sheet(), ASOF)
    expect(summary.products).toEqual([])
    expect(summary.activeCount).toBe(0)
    expect(summary.emptyNote).toContain('No purchased protection')
  })

  it('surfaces the facts an advisor needs before promising anything', () => {
    const summary = summarizeOwnership(sheet({ contracts: [contract()] }), ASOF)
    const vsc = summary.products[0]!
    expect(vsc.label).toBe('Service Contract')
    expect(vsc.adminCompany).toBe('Endurance')
    expect(vsc.tier).toBe('Platinum')
    expect(vsc.facts).toContain('$100 deductible')
  })

  it('counts prepaid plans in visits, not months', () => {
    // A plan with time left and no visits left is worthless.
    const summary = summarizeOwnership(sheet({
      contracts: [contract({ id: 'k2', productType: 'PPM', coverageTier: undefined })],
      prepaidEntitlements: [
        { contractId: 'k2', componentGroupKey: 'OIL_CHANGE', label: 'Oil', totalAllowed: 6, used: 4 },
      ] as PrepSheet['prepaidEntitlements'],
    }), ASOF)
    expect(summary.products[0]?.headline).toBe('2 of 6 visits left')
  })

  it('warns about the tread minimum on tire & wheel', () => {
    // The single most common reason a road-hazard claim is denied.
    const summary = summarizeOwnership(sheet({
      contracts: [contract({ productType: 'TIRE_WHEEL', minimumTreadDepth32nds: 3 })],
    }), ASOF)
    expect(summary.products[0]?.facts.some((f) => f.includes('3/32'))).toBe(true)
    expect(summary.products[0]?.talkTrack).toContain('3/32')
  })

  it('flags prior authorisation, because a teardown without it is a denied claim', () => {
    const summary = summarizeOwnership(sheet({
      contracts: [contract({ requiresPriorAuthorization: true })],
    }), ASOF)
    expect(summary.products[0]?.facts).toContain('Prior auth required')
    expect(summary.products[0]?.talkTrack).toContain('authorisation')
  })

  it('marks a contract expiring inside 90 days', () => {
    const summary = summarizeOwnership(sheet({
      contracts: [contract({ expirationDate: new Date('2026-09-15T12:00:00Z') })],
    }), ASOF)
    expect(summary.products[0]?.expiringSoon).toBe(true)
    expect(summary.expiringCount).toBe(1)
  })

  it('does not call a used-up prepaid plan expiring, because there is nothing to lose', () => {
    const summary = summarizeOwnership(sheet({
      contracts: [contract({ id: 'k2', productType: 'PPM', expirationDate: new Date('2026-09-15T12:00:00Z') })],
      prepaidEntitlements: [
        { contractId: 'k2', componentGroupKey: 'OIL_CHANGE', label: 'Oil', totalAllowed: 6, used: 6 },
      ] as PrepSheet['prepaidEntitlements'],
    }), ASOF)
    expect(summary.products[0]?.expiringSoon).toBe(false)
  })

  it('reports an expired contract as expired rather than hiding it', () => {
    // Customers assume these renew themselves. Finding out at the cashier is
    // how a comeback starts.
    const summary = summarizeOwnership(sheet({
      contracts: [contract({ status: 'EXPIRED' })],
    }), ASOF)
    expect(summary.products[0]?.headline).toBe('Expired')
    expect(summary.products[0]?.active).toBe(false)
    expect(summary.activeCount).toBe(0)
  })

  it('puts active products before expired ones', () => {
    const summary = summarizeOwnership(sheet({
      contracts: [
        contract({ id: 'dead', productType: 'VSC', status: 'EXPIRED' }),
        contract({ id: 'live', productType: 'DENT', status: 'ACTIVE' }),
      ],
    }), ASOF)
    expect(summary.products[0]?.key).toBe('owned:live')
  })

  it('ranks a service contract above cosmetic products', () => {
    const summary = summarizeOwnership(sheet({
      contracts: [
        contract({ id: 'dent', productType: 'DENT' }),
        contract({ id: 'vsc', productType: 'VSC' }),
      ],
    }), ASOF)
    expect(summary.products.map((p) => p.kind)).toEqual(['VSC', 'PDR'])
  })

  it('gives every product something the advisor can say', () => {
    const summary = summarizeOwnership(sheet({
      contracts: [
        contract({ id: 'a', productType: 'VSC' }),
        contract({ id: 'b', productType: 'TIRE_WHEEL' }),
        contract({ id: 'c', productType: 'WINDSHIELD' }),
        contract({ id: 'd', productType: 'KEY' }),
        contract({ id: 'e', productType: 'DENT' }),
      ],
    }), ASOF)
    for (const p of summary.products) {
      expect(p.talkTrack.length).toBeGreaterThan(20)
    }
  })
})

describe('ownershipHint', () => {
  const withTireWheel = summarizeOwnership(
    sheet({ contracts: [contract({ productType: 'TIRE_WHEEL', minimumTreadDepth32nds: 3 })] }),
    ASOF,
  )

  it('stays silent when the engine already routed the item to coverage', () => {
    // The card already says "covered". A hint here would be noise.
    expect(ownershipHint(opportunity({ likelyPayer: 'TIRE_WHEEL' }), withTireWheel)).toBeNull()
  })

  it('warns when they own tire & wheel but this tire job is wear', () => {
    const hint = ownershipHint(opportunity({ componentGroupKey: 'TIRES' }), withTireWheel)
    expect(hint).toContain('not road hazard')
  })

  it('flags a prepaid plan against an oil change quoted as customer pay', () => {
    const withPpm = summarizeOwnership(
      sheet({
        contracts: [contract({ id: 'k2', productType: 'PPM' })],
        prepaidEntitlements: [
          { contractId: 'k2', componentGroupKey: 'OIL_CHANGE', label: 'Oil', totalAllowed: 6, used: 1 },
        ] as PrepSheet['prepaidEntitlements'],
      }),
      ASOF,
    )
    const hint = ownershipHint(
      opportunity({ componentGroupKey: 'OIL_CHANGE', type: 'MAINTENANCE_DUE' }),
      withPpm,
    )
    expect(hint).toContain('prepaid plan')
  })

  it('names the wear exclusion when they own a service contract', () => {
    const withVsc = summarizeOwnership(sheet({ contracts: [contract()] }), ASOF)
    expect(ownershipHint(opportunity(), withVsc)).toContain('wear items are excluded')
  })

  it('says nothing when they own nothing relevant', () => {
    expect(ownershipHint(opportunity(), summarizeOwnership(sheet(), ASOF))).toBeNull()
  })

  it('ignores an expired product', () => {
    const expired = summarizeOwnership(
      sheet({ contracts: [contract({ productType: 'TIRE_WHEEL', status: 'EXPIRED' })] }),
      ASOF,
    )
    expect(ownershipHint(opportunity({ componentGroupKey: 'TIRES' }), expired)).toBeNull()
  })
})
