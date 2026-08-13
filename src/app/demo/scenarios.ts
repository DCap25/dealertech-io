import { subMonths } from 'date-fns'
import type { Contract, PrepaidEntitlement } from '@/lib/coverage'

/**
 * Preset coverage scenarios.
 *
 * These live outside actions.ts on purpose: a `'use server'` module may only
 * export async functions, so a plain object exported from there never reaches
 * the client — the dropdown silently renders empty.
 *
 * They exist so a dealer can change ONE dropdown and watch the payer flip from
 * customer-pay to covered. That comparison is the pitch.
 */
export type ScenarioKey =
  | 'NONE'
  | 'VSC_EXCLUSIONARY'
  | 'VSC_INCLUSIONARY'
  | 'TIRE_WHEEL'
  | 'PPM'

export const SCENARIO_KEYS: ScenarioKey[] = [
  'NONE',
  'VSC_EXCLUSIONARY',
  'VSC_INCLUSIONARY',
  'TIRE_WHEEL',
  'PPM',
]

export const SCENARIO_LABELS: Record<ScenarioKey, string> = {
  NONE: 'No products on file',
  VSC_EXCLUSIONARY: 'Zurich VSC — exclusionary, $100 deductible',
  VSC_INCLUSIONARY: 'Endurance VSC — inclusionary, powertrain only',
  TIRE_WHEEL: 'Tire & Wheel road hazard, $0 deductible',
  PPM: 'Prepaid maintenance — 3 oil changes left',
}

/**
 * When the demo contract was sold.
 *
 * Dating it from the vehicle's in-service date makes the demo useless on an
 * older car — a 120-month contract on a 2013 truck expired in 2023, so every
 * scenario silently collapsed to customer-pay. Contracts on used vehicles are
 * sold at resale anyway, so we date it 18 months back unless the car is new
 * enough for the original sale to still be live.
 */
function demoPurchaseDate(inServiceDate: Date, asOf: Date): Date {
  const threeYearsAgo = subMonths(asOf, 36)
  return inServiceDate > threeYearsAgo ? inServiceDate : subMonths(asOf, 18)
}

export function buildContracts(
  scenario: ScenarioKey,
  inServiceDate: Date,
  asOf: Date = new Date(),
): Contract[] {
  const base = {
    purchaseDate: demoPurchaseDate(inServiceDate, asOf),
    termMonths: 84,
    // Absolute odometer limit, generous enough that the demo turns on coverage
    // rules rather than on an arbitrary mileage cap.
    termMiles: 200_000,
    status: 'ACTIVE' as const,
    source: 'MANUAL' as const,
    coveredComponentGroups: [] as string[],
    excludedComponentGroups: [] as string[],
  }

  switch (scenario) {
    case 'VSC_EXCLUSIONARY':
      return [{
        ...base,
        id: 'demo-vsc-excl',
        productType: 'VSC',
        adminCompany: 'Zurich',
        contractNumber: 'ZUR-77213',
        coverageTier: 'Platinum',
        tierType: 'EXCLUSIONARY',
        deductibleAmount: 100,
        deductibleType: 'PER_VISIT',
        requiresPriorAuthorization: true,
        claimPhone: '800-555-0100',
      }]
    case 'VSC_INCLUSIONARY':
      return [{
        ...base,
        id: 'demo-vsc-incl',
        productType: 'VSC',
        adminCompany: 'Endurance',
        contractNumber: 'END-40192',
        coverageTier: 'Powertrain Select',
        tierType: 'INCLUSIONARY',
        // Named components only. Anything absent from this list is NOT covered.
        coveredComponentGroups: [
          'ENGINE_INTERNAL', 'TRANSMISSION_INTERNAL', 'TORQUE_CONVERTER',
          'DIFFERENTIAL', 'AXLE_SHAFTS_CV', 'TRANSFER_CASE',
        ],
        deductibleAmount: 200,
        deductibleType: 'PER_REPAIR',
        requiresPriorAuthorization: true,
        claimPhone: '866-555-0177',
      }]
    case 'TIRE_WHEEL':
      return [{
        ...base,
        id: 'demo-tw',
        productType: 'TIRE_WHEEL',
        adminCompany: 'Safeguard',
        tierType: 'INCLUSIONARY',
        coveredComponentGroups: ['TIRES', 'WHEELS_RIMS'],
        deductibleAmount: 0,
        deductibleType: 'NONE',
        requiresPriorAuthorization: false,
        minimumTreadDepth32nds: 3,
      }]
    default:
      return []
  }
}

export function buildEntitlements(scenario: ScenarioKey): PrepaidEntitlement[] {
  if (scenario !== 'PPM') return []
  return [
    { contractId: 'demo-ppm', componentGroupKey: 'OIL_CHANGE', totalAllowed: 5, used: 2 },
    { contractId: 'demo-ppm', componentGroupKey: 'TIRE_ROTATION', totalAllowed: 5, used: 2 },
  ]
}
