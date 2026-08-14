import type { ComponentGroup } from '@/lib/taxonomy'

/** F&I products that can pay for service work. GAP is finance-side and never pays a repair. */
export type ProductType =
  | 'VSC'
  | 'PPM'
  | 'TIRE_WHEEL'
  | 'KEY'
  | 'DENT'
  | 'WINDSHIELD'
  | 'APPEARANCE'
  | 'THEFT'

/**
 * How a VSC decides what it covers. Getting this backwards is how a store eats
 * a transmission.
 *
 * EXCLUSIONARY — covered UNLESS the component is expressly listed as excluded.
 *   The premium form. Silence means covered.
 * INCLUSIONARY — covered ONLY IF the component is expressly listed as covered.
 *   Also called "named component" or "stated component". Silence means NOT covered.
 */
export type TierType = 'EXCLUSIONARY' | 'INCLUSIONARY'

export type DeductibleType = 'PER_VISIT' | 'PER_REPAIR' | 'NONE'

export type ContractStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'EXHAUSTED'

/** Where the contract record came from — drives how much we trust it. */
export type ContractSource =
  | 'MANUAL'
  | 'CSV_IMPORT'
  | 'PDF_EXTRACTION'
  | 'PHOTO_EXTRACTION'
  | 'DMS'

/**
 * Sources where a machine did the reading.
 *
 * Grouped rather than listed at each call site: the trust rules below key off
 * this, and a new extraction source added later must inherit them by default
 * rather than by somebody remembering to.
 */
export const MACHINE_READ_SOURCES: ContractSource[] = ['PDF_EXTRACTION', 'PHOTO_EXTRACTION']

export function isMachineRead(source: ContractSource): boolean {
  return MACHINE_READ_SOURCES.includes(source)
}

export interface Contract {
  id: string
  productType: ProductType
  adminCompany: string
  contractNumber?: string

  purchaseDate: Date
  /** Odometer at sale — VSC terms usually run from in-service, but some run from sale mileage. */
  purchaseMileage?: number

  termMonths: number | null
  termMiles: number | null
  /** Absolute expiry, when the contract states one rather than a term length. */
  expirationDate?: Date
  expirationMiles?: number

  deductibleAmount: number
  deductibleType: DeductibleType

  coverageTier?: string
  tierType: TierType
  /** Meaningful for INCLUSIONARY tiers. Component group keys. */
  coveredComponentGroups: string[]
  /** Meaningful for EXCLUSIONARY tiers. Component group keys. */
  excludedComponentGroups: string[]

  /**
   * Nearly every administrator requires authorization before teardown. Starting
   * work without it is the most common reason a legitimate claim gets denied.
   */
  requiresPriorAuthorization: boolean
  claimPhone?: string
  claimPortalUrl?: string

  status: ContractStatus

  // ---- Tire & wheel specific ----
  /** Most road-hazard policies require tread above a floor, commonly 3/32". */
  minimumTreadDepth32nds?: number
  perTireLimit?: number

  // ---- Provenance ----
  source: ContractSource
  /** Set by AI extraction. An unverified low-confidence contract must not drive a confident answer. */
  extractionConfidence?: 'HIGH' | 'MEDIUM' | 'LOW'
  verifiedAt?: Date
}

/**
 * One redeemable line on a prepaid maintenance plan. The remaining balance is
 * the cheapest lever in the business for forcing a visit.
 */
export interface PrepaidEntitlement {
  contractId: string
  /** Component group key the entitlement redeems against, e.g. OIL_CHANGE. */
  componentGroupKey: string
  totalAllowed: number
  used: number
  expiresOn?: Date
}

export interface OpenRecall {
  campaignNumber: string
  /** Component groups the campaign touches. */
  componentGroupKeys: string[]
  description: string
  /**
   * TRUE when this came from an NHTSA make/model/year lookup rather than a
   * VIN-level remedy check. There is no free VIN-level open-recall API, so this
   * is the normal case — and the UI must never claim certainty about it.
   */
  isCandidate: boolean
}

/** Why the part failed. Decisive for tire & wheel and for warranty-vs-wear calls. */
export type DamageCause = 'ROAD_HAZARD' | 'WEAR' | 'DEFECT' | 'COLLISION' | 'UNKNOWN'

export interface OperationInput {
  opCode?: string
  /** Free text — op-code description, customer concern, or tech story. */
  description: string
  /** Set when the caller already knows the group. Otherwise resolved from `description`. */
  componentGroupKey?: string
  laborHours?: number
  laborAmount: number
  partsAmount: number
  damageCause?: DamageCause
  /** Current tread depth in 32nds, for tire & wheel eligibility. */
  treadDepth32nds?: number
}

export interface VehicleInput {
  vin?: string
  make: string
  model?: string
  modelYear: number
  inServiceDate: Date
  currentMileage: number
  isHybridOrEv?: boolean
  /** Drives the Hyundai/Kia/Genesis and Stellantis-lifetime powertrain distinctions. */
  isOriginalOwner: boolean
}

export interface StoreInput {
  laborRate: number
  /** Two-letter state code — determines CARB hybrid terms. */
  state?: string
  /** Months past factory warranty expiry within which goodwill is worth requesting. */
  goodwillWindowMonths?: number
}

export interface CustomerHistoryInput {
  visitCount: number
  lifetimeSpend: number
  lastVisitDate?: Date
}

export interface CoverageInput {
  vehicle: VehicleInput
  operation: OperationInput
  contracts?: Contract[]
  prepaidEntitlements?: PrepaidEntitlement[]
  openRecalls?: OpenRecall[]
  store: StoreInput
  history?: CustomerHistoryInput
  /** Injected for deterministic tests. Defaults to now. */
  asOf?: Date
}

export type Payer =
  | 'OEM_RECALL'
  | 'PPM'
  | 'TIRE_WHEEL'
  | 'OEM_WARRANTY'
  | 'VSC'
  | 'GOODWILL'
  | 'CUSTOMER_PAY'

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW'

/** One evaluated rule, kept whether it fired or not — this is the audit trail. */
export interface ReasoningStep {
  rule: string
  outcome: 'FIRED' | 'SKIPPED' | 'NOT_APPLICABLE'
  detail: string
}

export interface CoverageDetermination {
  payer: Payer
  /** Resolved group, or undefined when the description matched nothing known. */
  componentGroup: ComponentGroup | undefined

  /** What the customer pays, including any deductible. */
  customerOutOfPocket: number
  /** What the payer covers. */
  coveredAmount: number
  deductible: number
  deductibleType: DeductibleType

  /** Things the advisor MUST do — prior auth calls, portal verification, tread checks. */
  requiredActions: string[]
  confidence: Confidence
  reasoning: ReasoningStep[]
  /** Other payers worth checking. Surfaced so the advisor can challenge the answer. */
  alternatives: string[]
  disclaimer: string
  /** Populated when a payer is identified from a specific contract. */
  contractId?: string
  /** The specific warranty term that covered it, e.g. "Federal Emissions (Long)". */
  warrantyTermName?: string
}
