import { addDays, addMonths } from 'date-fns'
import type { DmsCoverage, DmsDriveBundle, DmsPrepaidEntitlement } from '../types'

/**
 * Coverage scenarios for the mock adapter.
 *
 * Pure overlays applied on top of whatever the seed contains, so any coverage
 * situation can be reproduced deterministically without editing the database.
 * The whole product turns on "who pays", and the four or five states that
 * question can be in need to be one env var apart during development.
 */

export type CoverageScenario =
  | 'AS_SEEDED'
  | 'NO_COVERAGE'
  | 'ACTIVE_VSC'
  | 'EXPIRING_PPM'
  | 'TIRE_AND_WHEEL'
  | 'FULL_STACK'

export const COVERAGE_SCENARIOS: CoverageScenario[] = [
  'AS_SEEDED', 'NO_COVERAGE', 'ACTIVE_VSC', 'EXPIRING_PPM', 'TIRE_AND_WHEEL', 'FULL_STACK',
]

export function isCoverageScenario(value: string | undefined): value is CoverageScenario {
  return !!value && (COVERAGE_SCENARIOS as string[]).includes(value)
}

/** Synthetic ids are prefixed so they are obviously not DMS records. */
const SYNTHETIC = 'mock-scenario'

function vscFor(vehicleId: string, customerId: string | null, asOf: Date): DmsCoverage {
  return {
    id: `${SYNTHETIC}-vsc-${vehicleId}`,
    vehicleId,
    customerId,
    productType: 'VSC',
    adminCompany: 'Endurance Dealer Services',
    contractNumber: 'VSC-MOCK-4471',
    purchaseDate: addMonths(asOf, -18),
    purchaseMileage: 22_000,
    termMonths: 60,
    termMiles: 75_000,
    expirationDate: addMonths(asOf, 42),
    expirationMiles: 97_000,
    deductibleAmount: 100,
    deductibleType: 'PER_VISIT',
    coverageTier: 'Exclusionary Platinum',
    tierType: 'EXCLUSIONARY',
    coveredComponentGroups: [],
    excludedComponentGroups: [],
    requiresPriorAuthorization: true,
    claimPhone: '(800) 555-0142',
    status: 'ACTIVE',
    minimumTreadDepth32nds: null,
    perTireLimit: null,
    source: 'MOCK_SCENARIO',
    verifiedAt: asOf,
  }
}

function tireWheelFor(vehicleId: string, customerId: string | null, asOf: Date): DmsCoverage {
  return {
    id: `${SYNTHETIC}-tw-${vehicleId}`,
    vehicleId,
    customerId,
    productType: 'TIRE_WHEEL',
    adminCompany: 'RoadGuard Tire & Wheel',
    contractNumber: 'TW-MOCK-8830',
    purchaseDate: addMonths(asOf, -12),
    purchaseMileage: 28_000,
    termMonths: 60,
    termMiles: null,
    expirationDate: addMonths(asOf, 48),
    expirationMiles: null,
    deductibleAmount: 0,
    deductibleType: 'NONE',
    coverageTier: 'Road hazard',
    tierType: 'INCLUSIONARY',
    coveredComponentGroups: ['TIRES', 'WHEELS_RIMS'],
    excludedComponentGroups: [],
    requiresPriorAuthorization: false,
    claimPhone: '(800) 555-0177',
    status: 'ACTIVE',
    // Road-hazard products stop paying once the tire is worn out anyway.
    minimumTreadDepth32nds: 3,
    perTireLimit: 350,
    source: 'MOCK_SCENARIO',
    verifiedAt: asOf,
  }
}

function ppmFor(vehicleId: string, customerId: string | null, asOf: Date): DmsCoverage {
  return {
    id: `${SYNTHETIC}-ppm-${vehicleId}`,
    vehicleId,
    customerId,
    productType: 'PPM',
    adminCompany: 'Store Prepaid Maintenance',
    contractNumber: 'PPM-MOCK-2210',
    purchaseDate: addMonths(asOf, -20),
    purchaseMileage: 15_000,
    termMonths: 24,
    termMiles: null,
    // Deliberately close: an expiring plan is the whole point of the scenario.
    expirationDate: addDays(asOf, 45),
    expirationMiles: null,
    deductibleAmount: 0,
    deductibleType: 'NONE',
    coverageTier: 'Oil & filter, 6 visits',
    tierType: 'INCLUSIONARY',
    coveredComponentGroups: ['OIL_CHANGE', 'TIRE_ROTATION'],
    excludedComponentGroups: [],
    requiresPriorAuthorization: false,
    claimPhone: null,
    status: 'ACTIVE',
    minimumTreadDepth32nds: null,
    perTireLimit: null,
    source: 'MOCK_SCENARIO',
    verifiedAt: asOf,
  }
}

function expiringEntitlements(vehicleId: string, asOf: Date): DmsPrepaidEntitlement[] {
  return [
    {
      vehicleId,
      contractId: `${SYNTHETIC}-ppm-${vehicleId}`,
      componentGroupKey: 'OIL_CHANGE',
      label: 'Oil Change',
      totalAllowed: 6,
      // Three unused visits about to vanish is the cheapest reason to book.
      used: 3,
      expiresOn: addDays(asOf, 45),
    },
    {
      vehicleId,
      contractId: `${SYNTHETIC}-ppm-${vehicleId}`,
      componentGroupKey: 'TIRE_ROTATION',
      label: 'Tire Rotation',
      totalAllowed: 6,
      used: 4,
      expiresOn: addDays(asOf, 45),
    },
  ]
}

/**
 * Apply a scenario across every vehicle in the bundle.
 *
 * Overlays replace coverage rather than adding to it, so a scenario always
 * describes the whole picture. A scenario that only appended would leave the
 * seeded contracts in place and make "NO_COVERAGE" a lie.
 */
export function applyCoverageScenario(
  bundle: DmsDriveBundle,
  scenario: CoverageScenario,
  asOf: Date,
): DmsDriveBundle {
  if (scenario === 'AS_SEEDED') return bundle

  const coverages: DmsCoverage[] = []
  const prepaidEntitlements: DmsPrepaidEntitlement[] = []

  for (const vehicle of bundle.vehicles) {
    const customerId = vehicle.customerId
    switch (scenario) {
      case 'NO_COVERAGE':
        break
      case 'ACTIVE_VSC':
        coverages.push(vscFor(vehicle.id, customerId, asOf))
        break
      case 'TIRE_AND_WHEEL':
        coverages.push(tireWheelFor(vehicle.id, customerId, asOf))
        break
      case 'EXPIRING_PPM':
        coverages.push(ppmFor(vehicle.id, customerId, asOf))
        prepaidEntitlements.push(...expiringEntitlements(vehicle.id, asOf))
        break
      case 'FULL_STACK':
        coverages.push(
          vscFor(vehicle.id, customerId, asOf),
          tireWheelFor(vehicle.id, customerId, asOf),
          ppmFor(vehicle.id, customerId, asOf),
        )
        prepaidEntitlements.push(...expiringEntitlements(vehicle.id, asOf))
        break
    }
  }

  return { ...bundle, coverages, prepaidEntitlements }
}
