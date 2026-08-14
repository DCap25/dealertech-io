import { describe, it, expect } from 'vitest'
import { evaluateCoverage } from './engine'
import type {
  Contract,
  CoverageInput,
  OpenRecall,
  OperationInput,
  PrepaidEntitlement,
  StoreInput,
  VehicleInput,
} from './types'

const NOW = new Date('2026-08-12T00:00:00Z')

const STORE: StoreInput = { laborRate: 185, state: 'TX' }

/** 2019 Ford, in service mid-2019, 78k miles — out of basic AND powertrain. */
function vehicle(overrides: Partial<VehicleInput> = {}): VehicleInput {
  return {
    vin: '1FTFW1ET5DFC10312',
    make: 'FORD',
    modelYear: 2019,
    inServiceDate: new Date('2019-06-15T00:00:00Z'),
    currentMileage: 78_000,
    isOriginalOwner: true,
    ...overrides,
  }
}

function op(description: string, overrides: Partial<OperationInput> = {}): OperationInput {
  return { description, laborAmount: 800, partsAmount: 400, ...overrides }
}

function vsc(overrides: Partial<Contract> = {}): Contract {
  return {
    id: 'vsc-1',
    productType: 'VSC',
    adminCompany: 'Zurich',
    contractNumber: 'ZUR-99812',
    purchaseDate: new Date('2019-06-15T00:00:00Z'),
    termMonths: 96,
    termMiles: 125_000,
    deductibleAmount: 100,
    deductibleType: 'PER_VISIT',
    tierType: 'EXCLUSIONARY',
    coveredComponentGroups: [],
    excludedComponentGroups: [],
    requiresPriorAuthorization: true,
    claimPhone: '800-555-0100',
    status: 'ACTIVE',
    source: 'MANUAL',
    ...overrides,
  }
}

function tireWheel(overrides: Partial<Contract> = {}): Contract {
  return {
    id: 'tw-1',
    productType: 'TIRE_WHEEL',
    adminCompany: 'Safeguard',
    purchaseDate: new Date('2019-06-15T00:00:00Z'),
    // 120 months keeps this live past `NOW`. An 84-month term would have lapsed
    // in June 2026 — which the engine correctly rejected the first time round.
    termMonths: 120,
    termMiles: null,
    deductibleAmount: 0,
    deductibleType: 'NONE',
    tierType: 'INCLUSIONARY',
    coveredComponentGroups: ['TIRES', 'WHEELS_RIMS'],
    excludedComponentGroups: [],
    requiresPriorAuthorization: false,
    status: 'ACTIVE',
    source: 'MANUAL',
    minimumTreadDepth32nds: 3,
    ...overrides,
  }
}

function evaluate(overrides: Partial<CoverageInput> = {}): ReturnType<typeof evaluateCoverage> {
  return evaluateCoverage({
    vehicle: vehicle(),
    operation: op('a/c compressor replacement', { componentGroupKey: 'AC_COMPRESSOR' }),
    store: STORE,
    asOf: NOW,
    ...overrides,
  })
}

// ===========================================================================
describe('waterfall ordering', () => {
  const recall: OpenRecall = {
    campaignNumber: '23V-456',
    componentGroupKeys: ['AC_COMPRESSOR'],
    description: 'Compressor clutch may seize',
    isCandidate: false,
  }

  it('puts an open recall ahead of an otherwise-valid service contract', () => {
    const result = evaluate({ openRecalls: [recall], contracts: [vsc()] })
    expect(result.payer).toBe('OEM_RECALL')
    expect(result.customerOutOfPocket).toBe(0)
    expect(result.deductible).toBe(0)
  })

  it('falls to the service contract once the recall does not match the component', () => {
    const result = evaluate({
      openRecalls: [{ ...recall, componentGroupKeys: ['AIRBAG_SRS'] }],
      contracts: [vsc()],
    })
    expect(result.payer).toBe('VSC')
  })

  it('records every rule it evaluated, not just the one that fired', () => {
    const result = evaluate({ contracts: [vsc()] })
    const rules = result.reasoning.map((r) => r.rule)
    expect(rules).toContain('open-recall')
    expect(rules).toContain('factory-warranty')
    expect(rules).toContain('service-contract')
    expect(result.reasoning.some((r) => r.outcome === 'FIRED')).toBe(true)
  })
})

// ===========================================================================
describe('open recalls', () => {
  it('flags a candidate recall as unconfirmed and drops confidence', () => {
    const result = evaluate({
      openRecalls: [
        {
          campaignNumber: '22V-101',
          componentGroupKeys: ['AC_COMPRESSOR'],
          description: 'Possible compressor failure',
          isCandidate: true,
        },
      ],
    })
    expect(result.payer).toBe('OEM_RECALL')
    expect(result.confidence).not.toBe('HIGH')
    // We must never claim a VIN-level open recall we cannot verify.
    expect(result.requiredActions.join(' ')).toContain('CANDIDATE')
    expect(result.requiredActions.join(' ')).toContain('OEM portal')
  })
})

// ===========================================================================
describe('prepaid maintenance', () => {
  const oilChange = op('oil and filter change', {
    componentGroupKey: 'OIL_CHANGE',
    laborAmount: 30,
    partsAmount: 60,
  })

  function entitlement(overrides: Partial<PrepaidEntitlement> = {}): PrepaidEntitlement {
    return {
      contractId: 'ppm-1',
      componentGroupKey: 'OIL_CHANGE',
      totalAllowed: 5,
      used: 2,
      ...overrides,
    }
  }

  it('redeems a remaining visit at zero cost to the customer', () => {
    const result = evaluate({ operation: oilChange, prepaidEntitlements: [entitlement()] })
    expect(result.payer).toBe('PPM')
    expect(result.customerOutOfPocket).toBe(0)
    expect(result.coveredAmount).toBe(90)
  })

  it('falls through to customer pay once the plan is exhausted', () => {
    const result = evaluate({
      operation: oilChange,
      prepaidEntitlements: [entitlement({ used: 5 })],
    })
    expect(result.payer).toBe('CUSTOMER_PAY')
    expect(result.customerOutOfPocket).toBe(90)
  })

  it('raises use-it-or-lose-it when the plan expires soon with visits left', () => {
    const result = evaluate({
      operation: oilChange,
      prepaidEntitlements: [entitlement({ expiresOn: new Date('2026-09-30T00:00:00Z') })],
    })
    expect(result.payer).toBe('PPM')
    expect(result.requiredActions.join(' ')).toMatch(/use it or lose it/i)
  })

  it('ignores an entitlement that has already expired', () => {
    const result = evaluate({
      operation: oilChange,
      prepaidEntitlements: [entitlement({ expiresOn: new Date('2025-01-01T00:00:00Z') })],
    })
    expect(result.payer).toBe('CUSTOMER_PAY')
  })

  it('does not redeem a maintenance plan against a mechanical repair', () => {
    const result = evaluate({ prepaidEntitlements: [entitlement()] })
    expect(result.payer).not.toBe('PPM')
  })
})

// ===========================================================================
describe('tire & wheel road hazard', () => {
  const tireOp = op('nail in tire, road hazard', {
    componentGroupKey: 'TIRES',
    laborAmount: 40,
    partsAmount: 310,
    damageCause: 'ROAD_HAZARD',
    treadDepth32nds: 7,
  })

  it('covers a road hazard tire with adequate tread', () => {
    const result = evaluate({ operation: tireOp, contracts: [tireWheel()] })
    expect(result.payer).toBe('TIRE_WHEEL')
    expect(result.customerOutOfPocket).toBe(0)
  })

  it('applies the policy deductible', () => {
    const result = evaluate({
      operation: tireOp,
      contracts: [tireWheel({ deductibleAmount: 50, deductibleType: 'PER_REPAIR' })],
    })
    expect(result.payer).toBe('TIRE_WHEEL')
    expect(result.customerOutOfPocket).toBe(50)
    expect(result.coveredAmount).toBe(300)
  })

  it('denies a tire below the policy tread minimum and says why', () => {
    const result = evaluate({
      operation: { ...tireOp, treadDepth32nds: 2 },
      contracts: [tireWheel()],
    })
    expect(result.payer).toBe('CUSTOMER_PAY')
    expect(result.reasoning.some((r) => r.detail.includes('below the policy minimum'))).toBe(true)
    // The other tires are still covered — that is a sale, not a dead end.
    expect(result.alternatives.join(' ')).toContain('OTHER tires')
  })

  it('does not pay a road hazard claim for ordinary tread wear', () => {
    const result = evaluate({
      operation: { ...tireOp, damageCause: 'WEAR' },
      contracts: [tireWheel()],
    })
    expect(result.payer).toBe('CUSTOMER_PAY')
  })

  it('requires the cause to be confirmed when it is unknown', () => {
    const result = evaluate({
      operation: { ...tireOp, damageCause: undefined },
      contracts: [tireWheel()],
    })
    expect(result.payer).toBe('TIRE_WHEEL')
    expect(result.requiredActions.join(' ')).toMatch(/road hazard/i)
    expect(result.confidence).not.toBe('HIGH')
  })

  it('prompts a tire & wheel sale when none is on file', () => {
    const result = evaluate({ operation: tireOp })
    expect(result.payer).toBe('CUSTOMER_PAY')
    expect(result.alternatives.join(' ')).toMatch(/worth selling/i)
  })

  it('caps at the per-tire limit', () => {
    const result = evaluate({
      operation: { ...tireOp, partsAmount: 600 },
      contracts: [tireWheel({ perTireLimit: 400 })],
    })
    expect(result.coveredAmount).toBe(400)
    expect(result.customerOutOfPocket).toBe(240)
  })
})

// ===========================================================================
describe('factory warranty', () => {
  it('catches the federal 8yr/80k emissions term on a car out of every other warranty', () => {
    // The headline case: 2019 Ford at 78k. Basic and powertrain are long gone,
    // but a catalytic converter is still free.
    const result = evaluate({
      operation: op('P0420 catalytic converter', { componentGroupKey: 'CATALYTIC_CONVERTER' }),
    })
    expect(result.payer).toBe('OEM_WARRANTY')
    expect(result.warrantyTermName).toBe('Federal Emissions (Long)')
    expect(result.customerOutOfPocket).toBe(0)
  })

  it('routes an alternator to customer pay, not powertrain', () => {
    // The most commonly misrouted component in the drive.
    const result = evaluate({ operation: op('alternator', { componentGroupKey: 'ALTERNATOR' }) })
    expect(result.payer).toBe('CUSTOMER_PAY')
  })

  it('covers a powertrain component while the powertrain term is alive', () => {
    const result = evaluate({
      vehicle: vehicle({ modelYear: 2024, inServiceDate: new Date('2024-03-01T00:00:00Z'), currentMileage: 28_000 }),
      operation: op('transmission', { componentGroupKey: 'TRANSMISSION_INTERNAL' }),
    })
    expect(result.payer).toBe('OEM_WARRANTY')
  })

  it('warns when a term is nearly exhausted and suggests a contract', () => {
    const result = evaluate({
      vehicle: vehicle({ modelYear: 2022, inServiceDate: new Date('2022-09-15T00:00:00Z'), currentMileage: 58_000 }),
      operation: op('transmission', { componentGroupKey: 'TRANSMISSION_INTERNAL' }),
    })
    expect(result.payer).toBe('OEM_WARRANTY')
    expect(result.requiredActions.join(' ')).toMatch(/nearly exhausted/i)
    expect(result.alternatives.join(' ')).toMatch(/service contract/i)
  })

  it('never treats a wear item as a warranty repair', () => {
    const result = evaluate({
      vehicle: vehicle({ modelYear: 2025, inServiceDate: new Date('2025-06-01T00:00:00Z'), currentMileage: 9_000 }),
      operation: op('brake pads', { componentGroupKey: 'BRAKE_PADS_SHOES' }),
    })
    expect(result.payer).toBe('CUSTOMER_PAY')
  })

  it('surfaces the Hyundai first-owner downgrade as a required action', () => {
    const result = evaluate({
      vehicle: vehicle({
        make: 'HYUNDAI',
        modelYear: 2019,
        currentMileage: 78_000,
        isOriginalOwner: false,
      }),
      operation: op('transmission', { componentGroupKey: 'TRANSMISSION_INTERNAL' }),
    })
    expect(result.payer).toBe('CUSTOMER_PAY')
  })

  it('covers the same Hyundai for the original owner', () => {
    const result = evaluate({
      vehicle: vehicle({ make: 'HYUNDAI', modelYear: 2019, currentMileage: 78_000, isOriginalOwner: true }),
      operation: op('transmission', { componentGroupKey: 'TRANSMISSION_INTERNAL' }),
    })
    expect(result.payer).toBe('OEM_WARRANTY')
    expect(result.requiredActions.join(' ')).toMatch(/original retail purchaser/i)
  })

  it('covers a hybrid battery in a CARB state that a non-CARB state would not', () => {
    const hybrid = {
      vehicle: vehicle({
        make: 'TOYOTA',
        modelYear: 2019,
        currentMileage: 120_000,
        isHybridOrEv: true,
      }),
      operation: op('hybrid battery', { componentGroupKey: 'HV_BATTERY_PACK', partsAmount: 4200 }),
    }
    const ca = evaluateCoverage({ ...hybrid, store: { ...STORE, state: 'CA' }, asOf: NOW })
    const tx = evaluateCoverage({ ...hybrid, store: { ...STORE, state: 'TX' }, asOf: NOW })
    expect(ca.payer).toBe('OEM_WARRANTY')
    expect(tx.payer).toBe('CUSTOMER_PAY')
  })
})

// ===========================================================================
describe('service contract tier semantics', () => {
  // The single most expensive distinction in the product.
  it('covers an unlisted component under an EXCLUSIONARY tier', () => {
    const result = evaluate({
      contracts: [vsc({ tierType: 'EXCLUSIONARY', excludedComponentGroups: [] })],
    })
    expect(result.payer).toBe('VSC')
    expect(result.reasoning.some((r) => r.detail.includes('not excluded'))).toBe(true)
  })

  it('DENIES the same component under an INCLUSIONARY tier', () => {
    const result = evaluate({
      contracts: [
        vsc({ tierType: 'INCLUSIONARY', coveredComponentGroups: ['TRANSMISSION_INTERNAL'] }),
      ],
    })
    expect(result.payer).toBe('CUSTOMER_PAY')
    expect(result.reasoning.some((r) => r.detail.includes('silence means NOT covered'))).toBe(true)
  })

  it('covers a named component under an INCLUSIONARY tier and warns to confirm the part', () => {
    const result = evaluate({
      contracts: [vsc({ tierType: 'INCLUSIONARY', coveredComponentGroups: ['AC_COMPRESSOR'] })],
    })
    expect(result.payer).toBe('VSC')
    expect(result.requiredActions.join(' ')).toMatch(/named-component/i)
  })

  it('honours an explicit exclusion on an exclusionary tier', () => {
    const result = evaluate({
      contracts: [vsc({ excludedComponentGroups: ['AC_COMPRESSOR'] })],
    })
    expect(result.payer).toBe('CUSTOMER_PAY')
  })

  it('applies the deductible to the customer and the balance to the contract', () => {
    const result = evaluate({ contracts: [vsc({ deductibleAmount: 250 })] })
    expect(result.payer).toBe('VSC')
    expect(result.customerOutOfPocket).toBe(250)
    expect(result.coveredAmount).toBe(950)
  })

  it('demands prior authorization before teardown', () => {
    const result = evaluate({ contracts: [vsc({ requiresPriorAuthorization: true })] })
    expect(result.requiredActions.join(' ')).toMatch(/PRIOR AUTHORIZATION REQUIRED/)
    expect(result.requiredActions.join(' ')).toContain('800-555-0100')
  })

  it('rejects a contract lapsed on mileage', () => {
    const result = evaluate({
      vehicle: vehicle({ currentMileage: 130_000 }),
      contracts: [vsc({ termMiles: 125_000 })],
    })
    expect(result.payer).toBe('CUSTOMER_PAY')
    expect(result.reasoning.some((r) => r.detail.includes('exceeds limit'))).toBe(true)
  })

  it('never pays a wear item from a service contract', () => {
    const result = evaluate({
      operation: op('brake pads', { componentGroupKey: 'BRAKE_PADS_SHOES' }),
      contracts: [vsc()],
    })
    expect(result.payer).toBe('CUSTOMER_PAY')
    expect(result.reasoning.some((r) => r.detail.includes('wear item'))).toBe(true)
  })

  it('tries a second contract when the first does not cover the part', () => {
    const result = evaluate({
      contracts: [
        vsc({ id: 'a', tierType: 'INCLUSIONARY', coveredComponentGroups: ['TRANSMISSION_INTERNAL'] }),
        vsc({ id: 'b', adminCompany: 'JM&A', tierType: 'EXCLUSIONARY' }),
      ],
    })
    expect(result.payer).toBe('VSC')
    expect(result.contractId).toBe('b')
  })
})

// ===========================================================================
describe('trust and confidence', () => {
  it('will not state a confident answer from an unverified extracted contract', () => {
    const result = evaluate({
      contracts: [vsc({ source: 'PDF_EXTRACTION', extractionConfidence: 'MEDIUM' })],
    })
    expect(result.payer).toBe('VSC')
    expect(result.confidence).toBe('LOW')
    expect(result.requiredActions.join(' ')).toMatch(/read from a document/i)
  })

  it('degrades to LOW for a make we have no warranty data for', () => {
    const result = evaluate({ vehicle: vehicle({ make: 'DELOREAN' }) })
    expect(result.confidence).toBe('LOW')
  })

  it('refuses to guess when the description matches nothing', () => {
    const result = evaluateCoverage({
      vehicle: vehicle(),
      operation: op('zzzz qqqq wwww'),
      store: STORE,
      asOf: NOW,
    })
    expect(result.confidence).toBe('LOW')
    expect(result.componentGroup).toBeUndefined()
    expect(result.requiredActions.join(' ')).toMatch(/Select a component group manually/i)
    // Crucially it does NOT assert the customer owes the money.
    expect(result.alternatives.join(' ')).toMatch(/not a determination/i)
  })

  it('flags components whose treatment genuinely varies between brands', () => {
    const result = evaluate({
      operation: op('water pump', { componentGroupKey: 'WATER_PUMP' }),
    })
    expect(result.confidence).not.toBe('HIGH')
    expect(result.reasoning.some((r) => r.rule === 'coverage-varies')).toBe(true)
  })

  it('always carries the advisory disclaimer', () => {
    expect(evaluate().disclaimer).toMatch(/does not adjudicate claims/i)
  })

  it('resolves a component from free text when no key is supplied', () => {
    const result = evaluateCoverage({
      vehicle: vehicle(),
      operation: op('customer states a/c compressor is not cooling'),
      store: STORE,
      asOf: NOW,
    })
    expect(result.componentGroup?.key).toBe('AC_COMPRESSOR')
  })
})

// ===========================================================================
describe('goodwill prompting', () => {
  it('prompts a policy adjustment for a loyal customer just outside warranty', () => {
    // Basic 3yr/36k lapsed on TIME roughly 6 months ago, still under the mileage
    // cap — exactly the situation where a manufacturer will often assist.
    const result = evaluate({
      vehicle: vehicle({
        modelYear: 2023,
        inServiceDate: new Date('2023-02-01T00:00:00Z'),
        currentMileage: 30_000,
      }),
      operation: op('a/c compressor', { componentGroupKey: 'AC_COMPRESSOR' }),
      history: { visitCount: 7, lifetimeSpend: 4200 },
    })
    expect(result.payer).toBe('CUSTOMER_PAY')
    expect(result.requiredActions.join(' ')).toContain('GOODWILL CANDIDATE')
    // Goodwill is discretionary — the engine must never present it as owed.
    expect(result.requiredActions.join(' ')).toMatch(/do not promise it/i)
    expect(result.payer).not.toBe('GOODWILL')
  })

  it('does not prompt goodwill for a stranger', () => {
    // Same car, same moment — only the relationship differs.
    const result = evaluate({
      vehicle: vehicle({
        modelYear: 2023,
        inServiceDate: new Date('2023-02-01T00:00:00Z'),
        currentMileage: 30_000,
      }),
      history: { visitCount: 1, lifetimeSpend: 90 },
    })
    expect(result.requiredActions.join(' ')).not.toContain('GOODWILL CANDIDATE')
  })

  it('does not prompt goodwill on a car years out of warranty', () => {
    const result = evaluate({ history: { visitCount: 10, lifetimeSpend: 9000 } })
    expect(result.requiredActions.join(' ')).not.toContain('GOODWILL CANDIDATE')
  })
})

describe('machine-read contracts', () => {
  it('treats a photographed contract with the same suspicion as a PDF one', () => {
    // The rule was written when PDF_EXTRACTION was the only machine-read
    // source. A new source must inherit it by default, not by somebody
    // remembering to add it at two call sites.
    const result = evaluate({ contracts: [vsc({ source: 'PHOTO_EXTRACTION' })] })
    expect(result.confidence).toBe('LOW')
    expect(result.requiredActions.join(' ')).toMatch(/read from a document/i)
  })

  it('stops warning once a human has verified it', () => {
    const result = evaluate({
      contracts: [vsc({ source: 'PHOTO_EXTRACTION', verifiedAt: new Date('2026-08-12') })],
    })
    expect(result.requiredActions.join(' ')).not.toMatch(/read from a document/i)
  })
})
