/**
 * Pure DMS surface: types, the adapter contract, mappers and mock scenarios.
 *
 * Deliberately does NOT re-export the registry. `getDmsAdapter()` touches the
 * database and is server-only, so reaching for it should be an explicit
 * `@/lib/dms/registry` import rather than something a client component can
 * pull in by accident through a barrel.
 */
export * from './types'
export { unsupported, type DmsAdapter } from './adapter'
export {
  emptyBundle, lastServiceMileageByGroup, toContract, toInspectionSnapshots,
  toPrepaidEntitlement, toPrepSheetInputs, type StoreProfile,
} from './map'
export {
  COVERAGE_SCENARIOS, applyCoverageScenario, isCoverageScenario, type CoverageScenario,
} from './mock/scenarios'
