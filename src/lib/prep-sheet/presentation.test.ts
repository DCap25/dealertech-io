import { describe, it, expect } from 'vitest'
import {
  buildCoverageSegments, computeRunningTotals, customerDetail, easyYesReasons,
  estimateGross, isCustomerFacing, termPercentRemaining, toneForPercent, vinLastSix,
  type OpportunityDecision,
} from './presentation'
import type { Opportunity, PrepSheet } from './types'
import type { TermStatus } from '@/lib/warranty'

const NOW = new Date('2026-08-12T12:00:00Z')

function term(overrides: Partial<TermStatus> = {}): TermStatus {
  return {
    name: 'Basic (Bumper-to-Bumper)',
    term: { months: 36, miles: 36_000 },
    active: true,
    monthsRemaining: 18,
    milesRemaining: 18_000,
    expiresOn: new Date('2028-01-01'),
    expiresAtMiles: 36_000,
    limitingFactor: 'TIME',
    expiredBy: null,
    ...overrides,
  }
}

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'o1',
    type: 'DECLINED_SERVICE',
    title: 'Front Brake Pads',
    detail: 'Declined 6 months ago',
    estimatedAmount: 618,
    customerOutOfPocket: 618,
    likelyPayer: 'CUSTOMER_PAY',
    urgency: 'HIGH',
    closeProbability: 0.4,
    priorityScore: 500,
    talkTrack: 'Lead with safety.',
    ...overrides,
  }
}

describe('coverage tone', () => {
  it('goes green, amber, red as life runs out', () => {
    expect(toneForPercent(80, true)).toBe('GOOD')
    expect(toneForPercent(30, true)).toBe('WARNING')
    expect(toneForPercent(8, true)).toBe('CRITICAL')
  })

  it('treats an inactive term as expired regardless of percentage', () => {
    expect(toneForPercent(90, false)).toBe('EXPIRED')
  })

  it('shows an active term at 0% as CRITICAL, never expired', () => {
    // 0 months but 8,860 miles left is still usable coverage. Greying it out
    // tells the advisor it is gone — the exact mistake we exist to prevent.
    expect(toneForPercent(0, true)).toBe('CRITICAL')
  })
})

describe('term percent remaining', () => {
  it('takes the axis that will run out first, not the rosier one', () => {
    // Half the months left but only a tenth of the miles — the customer is
    // about to lose coverage on mileage, so that is what must be shown.
    const t = term({ monthsRemaining: 18, milesRemaining: 3_600 })
    expect(termPercentRemaining(t)).toBeCloseTo(10, 1)
  })

  it('reports zero for an expired term', () => {
    expect(termPercentRemaining(term({ active: false }))).toBe(0)
  })

  it('treats an unlimited axis as full', () => {
    const t = term({ term: { months: 60, miles: null }, monthsRemaining: 30, milesRemaining: null })
    expect(termPercentRemaining(t)).toBeCloseTo(50, 1)
  })

  it('never returns more than 100 or less than 0', () => {
    const over = term({ monthsRemaining: 999, milesRemaining: 999_999 })
    expect(termPercentRemaining(over)).toBe(100)
  })
})

describe('easy-yes reasons', () => {
  it('leads with money the customer does not owe', () => {
    const reasons = easyYesReasons(
      opportunity({ likelyPayer: 'VSC', customerOutOfPocket: 0, urgency: 'MEDIUM' }),
    )
    expect(reasons[0]?.key).toBe('free')
    expect(reasons[0]?.tone).toBe('COVERED')
  })

  it('calls out a recall as manufacturer-funded', () => {
    const reasons = easyYesReasons(opportunity({ likelyPayer: 'OEM_RECALL', customerOutOfPocket: 0 }))
    expect(reasons[0]?.label).toBe('Manufacturer pays')
  })

  it('flags prepaid work as already paid for', () => {
    const reasons = easyYesReasons(opportunity({ likelyPayer: 'PPM', customerOutOfPocket: 0 }))
    expect(reasons[0]?.label).toBe('Already paid for')
  })

  it('shows the small remainder when coverage nearly pays it all', () => {
    const reasons = easyYesReasons(
      opportunity({ likelyPayer: 'VSC', estimatedAmount: 2000, customerOutOfPocket: 100 }),
    )
    expect(reasons.some((r) => r.label.includes('$100'))).toBe(true)
  })

  it('ranks safety above a high close rate', () => {
    const reasons = easyYesReasons(
      opportunity({ urgency: 'SAFETY', closeProbability: 0.9, likelyPayer: 'CUSTOMER_PAY' }),
    )
    expect(reasons[0]?.key).toBe('safety')
  })

  it('notes an item that was declined before', () => {
    const reasons = easyYesReasons(opportunity({ type: 'DECLINED_SERVICE' }))
    expect(reasons.some((r) => r.key === 'declined')).toBe(true)
  })

  it('gives an ordinary customer-pay job no covered badge', () => {
    const reasons = easyYesReasons(
      opportunity({ likelyPayer: 'CUSTOMER_PAY', urgency: 'MEDIUM', closeProbability: 0.3, type: 'MAINTENANCE_DUE' }),
    )
    expect(reasons.some((r) => r.tone === 'COVERED')).toBe(false)
  })
})

describe('gross estimation', () => {
  it('estimates store gross from the blended margin', () => {
    // 55% labour at 72% GP + 45% parts at 40% GP = 57.6%
    expect(estimateGross(1000)).toBe(576)
  })

  it('returns nothing for a zero-value item', () => {
    expect(estimateGross(0)).toBe(0)
  })
})

describe('running totals', () => {
  const list = [
    opportunity({ id: 'a', estimatedAmount: 1000, customerOutOfPocket: 100 }),
    opportunity({ id: 'b', estimatedAmount: 500, customerOutOfPocket: 500 }),
    opportunity({ id: 'c', estimatedAmount: 200, customerOutOfPocket: 0 }),
  ]

  it('counts everything as remaining before any decision', () => {
    const t = computeRunningTotals(list, {})
    expect(t.opportunityValue).toBe(1700)
    expect(t.remainingValue).toBe(1700)
    expect(t.pendingCount).toBe(3)
    expect(t.acceptedValue).toBe(0)
  })

  it('moves an accepted item into accepted totals with its gross', () => {
    const decisions: Record<string, OpportunityDecision> = { a: 'ACCEPTED' }
    const t = computeRunningTotals(list, decisions)
    expect(t.acceptedValue).toBe(1000)
    expect(t.acceptedGross).toBe(576)
    expect(t.acceptedCustomerOwes).toBe(100)
    expect(t.acceptedCovered).toBe(900)
    expect(t.remainingValue).toBe(700)
    expect(t.acceptedCount).toBe(1)
  })

  it('tracks declines separately from what is still winnable', () => {
    const t = computeRunningTotals(list, { b: 'DECLINED' })
    expect(t.declinedValue).toBe(500)
    expect(t.declinedCount).toBe(1)
    expect(t.remainingValue).toBe(1200)
  })

  it('stops counting a skipped item as still winnable', () => {
    // Otherwise the remaining figure never moves and the number is useless.
    const t = computeRunningTotals(list, { c: 'SKIPPED' })
    expect(t.remainingValue).toBe(1500)
    expect(t.pendingCount).toBe(2)
    expect(t.declinedValue).toBe(0)
  })

  it('keeps the total opportunity constant however it is worked', () => {
    const t = computeRunningTotals(list, { a: 'ACCEPTED', b: 'DECLINED', c: 'SKIPPED' })
    expect(t.opportunityValue).toBe(1700)
    expect(t.pendingCount).toBe(0)
  })
})

describe('coverage segments', () => {
  function sheet(overrides: Partial<PrepSheet> = {}): PrepSheet {
    return {
      customer: {
        id: 'c1', name: 'Maria Perez', visitCount: 6, lifetimeSpend: 3800,
        lastVisitAt: null, preferredChannel: 'SMS', pinnedNotes: [],
      },
      vehicle: {
        id: 'v1', vin: '1FTFW1ET9DFC10312', make: 'FORD', model: 'F-150', modelYear: 2021,
        inServiceDate: new Date('2021-05-01'), currentMileage: 62_000,
        avgMilesPerDay: 32, isHybridOrEv: false, isOriginalOwner: true,
      },
      appointment: undefined,
      warranty: {
        make: 'FORD', modelYear: 2021, known: true, program: undefined,
        basic: term(), powertrain: null, corrosion: null,
        emissionsLong: term({ name: 'Federal Emissions (Long)', active: false, monthsRemaining: -1 }),
        emissionsShort: term(), hybridEv: null, warnings: [],
      },
      contracts: [],
      prepaidEntitlements: [],
      inspectionHistory: [],
      projectedMileage: 62_000,
      opportunities: [],
      totals: { opportunityValue: 0, customerOutOfPocket: 0, coveredValue: 0 },
      alerts: [],
      ...overrides,
    }
  }

  it('renders a ring per active warranty term', () => {
    const segments = buildCoverageSegments(sheet(), NOW)
    expect(segments.some((s) => s.shortLabel === 'Basic')).toBe(true)
    expect(segments.every((s) => s.kind === 'WARRANTY')).toBe(true)
  })

  it('shows prepaid maintenance as visits left, not a duration', () => {
    const segments = buildCoverageSegments(
      sheet({
        prepaidEntitlements: [
          { contractId: 'p1', componentGroupKey: 'OIL_CHANGE', label: 'Oil Change', totalAllowed: 5, used: 2 },
        ],
      }),
      NOW,
    )
    const ppm = segments.find((s) => s.kind === 'PPM')
    expect(ppm?.primary).toBe('3 left')
    expect(ppm?.secondary).toBe('of 5')
    expect(ppm?.percentRemaining).toBeCloseTo(60, 1)
  })

  it('warns on a prepaid plan expiring soon even when visits remain', () => {
    const segments = buildCoverageSegments(
      sheet({
        prepaidEntitlements: [{
          contractId: 'p1', componentGroupKey: 'OIL_CHANGE', label: 'Oil Change',
          totalAllowed: 5, used: 1, expiresOn: new Date('2026-09-20T12:00:00Z'),
        }],
      }),
      NOW,
    )
    const ppm = segments.find((s) => s.kind === 'PPM')
    // 4 of 5 left would otherwise be green — imminent expiry outranks that.
    expect(ppm?.tone).toBe('WARNING')
    expect(ppm?.detail).toMatch(/already paid/i)
  })

  it('describes an exclusionary contract differently from a named-component one', () => {
    const base = {
      id: 'v1', productType: 'VSC' as const, adminCompany: 'Zurich',
      purchaseDate: new Date('2024-01-01'), termMonths: 84, termMiles: 100_000,
      deductibleAmount: 100, deductibleType: 'PER_VISIT' as const,
      coveredComponentGroups: [], excludedComponentGroups: [],
      requiresPriorAuthorization: true, status: 'ACTIVE' as const, source: 'MANUAL' as const,
    }
    const excl = buildCoverageSegments(sheet({ contracts: [{ ...base, tierType: 'EXCLUSIONARY' }] }), NOW)
    const incl = buildCoverageSegments(sheet({ contracts: [{ ...base, tierType: 'INCLUSIONARY' }] }), NOW)

    expect(excl.find((s) => s.kind === 'VSC')?.detail).toMatch(/unless expressly excluded/i)
    expect(incl.find((s) => s.kind === 'VSC')?.detail).toMatch(/only if expressly listed/i)
  })

  it('surfaces the prior-authorisation requirement on the contract ring', () => {
    const segments = buildCoverageSegments(
      sheet({
        contracts: [{
          id: 'v1', productType: 'VSC', adminCompany: 'Zurich',
          purchaseDate: new Date('2024-01-01'), termMonths: 84, termMiles: 100_000,
          deductibleAmount: 0, deductibleType: 'NONE', tierType: 'EXCLUSIONARY',
          coveredComponentGroups: [], excludedComponentGroups: [],
          requiresPriorAuthorization: true, status: 'ACTIVE', source: 'MANUAL',
        }],
      }),
      NOW,
    )
    expect(segments.find((s) => s.kind === 'VSC')?.detail).toMatch(/prior authorisation/i)
  })
})

describe('customer-facing filtering', () => {
  it('keeps real service work on the customer menu', () => {
    expect(isCustomerFacing(opportunity({ type: 'WEAR_PREDICTED' }))).toBe(true)
    expect(isCustomerFacing(opportunity({ type: 'MAINTENANCE_DUE' }))).toBe(true)
    expect(isCustomerFacing(opportunity({ type: 'RECALL_OPEN' }))).toBe(true)
  })

  it('hides product pitches from the customer menu', () => {
    // "Service contract, $2,400" beside a tire rotation inflates the apparent
    // bill and muddles two different conversations.
    expect(isCustomerFacing(opportunity({ type: 'WARRANTY_EXPIRING' }))).toBe(false)
    expect(isCustomerFacing(opportunity({ type: 'CONTRACT_UPSELL' }))).toBe(false)
  })

  it('prefers customer wording when the advisor detail is an instruction', () => {
    const o = opportunity({
      detail: 'No record of this service — confirm history with the customer.',
      customerDetail: 'Recommended at 52,500 miles.',
    })
    expect(customerDetail(o)).toBe('Recommended at 52,500 miles.')
  })

  it('falls back to the normal detail when there is no customer version', () => {
    const o = opportunity({ detail: 'Worst corner RF is at 4/32".' })
    expect(customerDetail(o)).toBe('Worst corner RF is at 4/32".')
  })
})

describe('vin display', () => {
  it('takes the last six characters', () => {
    expect(vinLastSix('1FTFW1ET9DFC10312')).toBe('C10312')
  })

  it('leaves a short string alone', () => {
    expect(vinLastSix('ABC')).toBe('ABC')
  })
})
