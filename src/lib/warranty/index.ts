export {
  FEDERAL_EMISSIONS,
  FEDERAL_HYBRID_EV,
  CARB_HYBRID_EV_BATTERY,
  CARB_STATES,
  isCarbState,
  type Term,
  type OemWarrantyProgram,
  type CarbState,
} from './types'
export { OEM_WARRANTY_PROGRAMS, findWarrantyProgram, knownMakes } from './programs'
export {
  computeWarrantySnapshot,
  computeTermStatus,
  type VehicleWarrantyInput,
  type WarrantySnapshot,
  type TermStatus,
} from './compute'
