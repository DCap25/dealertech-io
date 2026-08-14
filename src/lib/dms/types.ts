/**
 * DMS boundary types.
 *
 * These describe what a dealer management system knows and DealerTech does
 * not: appointments, customers, vehicles, purchased coverage, closed repair
 * orders and inspection measurements. They are deliberately DMS-agnostic —
 * nothing here mentions CDK, Reynolds or Tekion, and no vendor field names
 * leak through. Each concrete adapter is responsible for translating its own
 * vendor payloads into these shapes.
 *
 * What is NOT here is as important as what is. Coverage determinations, prep
 * sheet outcomes, cadence tasks and advisor performance are DealerTech's own
 * records; the DMS has never heard of them and never will. Modelling them here
 * would be the first step toward trying to replace the DMS instead of sitting
 * beside it.
 */

/** Stable identity for a record inside the source system. */
export type DmsId = string

export interface DmsCustomer {
  id: DmsId
  firstName: string | null
  lastName: string | null
  companyName: string | null
  phone: string | null
  email: string | null
  /** How the store has agreed to reach them. */
  preferredChannel: string
  doNotCall: boolean
  smsConsent: boolean
  visitCount: number
  lifetimeSpend: number
  lastVisitAt: Date | null
}

export interface DmsVehicle {
  id: DmsId
  customerId: DmsId | null
  vin: string
  make: string
  model: string | null
  modelYear: number
  trim: string | null
  licensePlate: string | null
  /** Warranty start. Absent in many DMS records, which the engine handles. */
  inServiceDate: Date | null
  currentMileage: number | null
  /** Derived from odometer history where the source system provides it. */
  avgMilesPerDay: number | null
  isHybridOrEv: boolean
  /**
   * Whether the current owner is the original one. Load-bearing: several OEM
   * powertrain terms are original-owner-only, so a wrong answer here changes
   * who pays.
   */
  isOriginalOwner: boolean
}

export interface DmsAppointment {
  id: DmsId
  customerId: DmsId | null
  vehicleId: DmsId | null
  /** Advisor as the DMS knows them, not as DealerTech knows them. */
  advisorId: DmsId | null
  advisorName: string | null
  scheduledAt: Date
  promisedAt: Date | null
  /** Waiter, loaner, drop-off — vocabulary varies by DMS, normalised here. */
  transportType: string
  status: string
  /** The customer's own words. Never rewrite this. */
  customerConcerns: string | null
}

export type DmsCoverageProduct =
  | 'VSC'
  | 'PPM'
  | 'TIRE_WHEEL'
  | 'PDR'
  | 'WINDSHIELD'
  | 'KEY'
  | 'APPEARANCE'
  | 'THEFT'
  | 'GAP'
  | 'OTHER'

/**
 * A purchased protection product.
 *
 * The single most valuable thing we pull. Most stores cannot answer "what does
 * this customer already own" at the drive, which is why advisors sell work the
 * customer had already paid to have covered.
 */
export interface DmsCoverage {
  id: DmsId
  vehicleId: DmsId
  customerId: DmsId | null
  productType: DmsCoverageProduct
  adminCompany: string
  contractNumber: string | null
  purchaseDate: Date
  purchaseMileage: number | null
  termMonths: number | null
  termMiles: number | null
  expirationDate: Date | null
  expirationMiles: number | null
  deductibleAmount: number
  deductibleType: string
  coverageTier: string | null
  /** Exclusionary covers all but a list; inclusionary covers only a list. */
  tierType: 'EXCLUSIONARY' | 'INCLUSIONARY'
  coveredComponentGroups: string[]
  excludedComponentGroups: string[]
  requiresPriorAuthorization: boolean
  claimPhone: string | null
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED'
  /** Tire & wheel specifics, when the product carries them. */
  minimumTreadDepth32nds: number | null
  perTireLimit: number | null
  /** How we came to know about it — DMS feed, PDF extraction, manual entry. */
  source: string
  verifiedAt: Date | null
}

/** Prepaid maintenance visits, counted rather than timed. */
export interface DmsPrepaidEntitlement {
  vehicleId: DmsId
  contractId: DmsId | null
  componentGroupKey: string
  label: string
  totalAllowed: number
  used: number
  expiresOn: Date | null
}

export interface DmsInspectionItem {
  itemKey: string
  componentGroupKey: string | null
  /** The measurement itself. Null where the tech only recorded a status. */
  value: number | null
  unit: string | null
  /** Wheel position for per-corner measurements. */
  position: string | null
}

export interface DmsInspection {
  id: DmsId
  vehicleId: DmsId
  mileage: number | null
  recordedAt: Date
  items: DmsInspectionItem[]
}

/** One line of closed work. Feeds maintenance intervals and history. */
export interface DmsServiceLine {
  repairOrderId: DmsId
  vehicleId: DmsId
  componentGroupKey: string | null
  description: string
  mileage: number | null
  closedAt: Date | null
  payType: string
  amount: number
  customerAmount: number
}

/** Work the customer turned down, with the price they were quoted. */
export interface DmsDeclinedService {
  id: DmsId
  vehicleId: DmsId
  customerId: DmsId
  description: string
  componentGroupKey: string | null
  quotedAmount: number
  declinedAt: Date
  mileageAtDecline: number | null
  resolvedAt: Date | null
}

export interface DmsRecall {
  vehicleId: DmsId
  campaignNumber: string
  description: string
  componentGroupKeys: string[]
  isCandidate: boolean
  parkIt: boolean
  parkOutside: boolean
}

export interface DmsCustomerNote {
  customerId: DmsId
  body: string
  isPinned: boolean
}

// ===========================================================================
// Pull shapes

export interface DateRange {
  from: Date
  /** Exclusive. */
  to: Date
}

/**
 * Everything needed to build a day of prep sheets, in one round trip.
 *
 * Deliberately a bundle rather than N per-entity calls: a 40-RO Saturday would
 * otherwise be several hundred requests against a DMS that is often rate
 * limited and always slow.
 */
export interface DmsDriveBundle {
  appointments: DmsAppointment[]
  customers: DmsCustomer[]
  vehicles: DmsVehicle[]
  coverages: DmsCoverage[]
  prepaidEntitlements: DmsPrepaidEntitlement[]
  inspections: DmsInspection[]
  declinedServices: DmsDeclinedService[]
  recalls: DmsRecall[]
  serviceLines: DmsServiceLine[]
  customerNotes: DmsCustomerNote[]
}

/** Everything known about one vehicle, for a record page rather than a drive. */
export interface DmsVehicleDetail {
  vehicle: DmsVehicle
  customer: DmsCustomer | null
  coverages: DmsCoverage[]
  prepaidEntitlements: DmsPrepaidEntitlement[]
  inspections: DmsInspection[]
  serviceLines: DmsServiceLine[]
  declinedServices: DmsDeclinedService[]
  recalls: DmsRecall[]
}

// ===========================================================================
// Push shapes
//
// What we send back. Most DMS platforms will not let a third party create
// priced RO lines, and the ones that do gate it behind certification. So the
// contract is written around what is realistically achievable everywhere:
// attaching notes and recommendations to a record the advisor already owns.

export interface HandOffLine {
  title: string
  /** The customer's concern in service-writer language. */
  concern: string
  componentGroupKey: string | null
  /** Our determination, always advisory — the DMS remains system of record. */
  recommendedPayType: string
  estimatedAmount: number
  customerOutOfPocket: number
  coveredAmount: number
  /** Plain-English reason, so the note survives without our UI. */
  coverageNote: string | null
}

export interface HandOffPayload {
  appointmentId: DmsId | null
  repairOrderId: DmsId | null
  customerId: DmsId
  vehicleId: DmsId
  mileage: number | null
  /** Lines the customer approved. */
  accepted: HandOffLine[]
  /** Lines they turned down, so the DMS records the offer was made. */
  declined: HandOffLine[]
  /** Free-text block, already formatted for a comment field. */
  note: string
  createdAt: Date
}

export type FollowUpOutcome =
  | 'APPOINTMENT_SET'
  | 'CALLBACK_REQUESTED'
  | 'NOT_INTERESTED'
  | 'NO_ANSWER'
  | 'LEFT_VOICEMAIL'
  | 'WRONG_NUMBER'
  | 'DO_NOT_CONTACT'

export interface FollowUpOutcomePayload {
  customerId: DmsId
  vehicleId: DmsId | null
  outcome: FollowUpOutcome
  notes: string | null
  occurredAt: Date
  /** Set when the call produced a booking, so the DMS can link them. */
  resultingAppointmentId: DmsId | null
}

/**
 * The result of a push.
 *
 * Never throws for a rejected write — a DMS refusing a note is an ordinary
 * Tuesday, and an advisor mid-drive should see "couldn't send, here's the
 * text" rather than a crashed page.
 */
export interface DmsPushResult {
  ok: boolean
  /** Identifier in the source system, when it hands one back. */
  externalRef: string | null
  message: string
}

// ===========================================================================

/**
 * What this adapter can actually do.
 *
 * Real DMS integrations differ enormously in what they permit, and the honest
 * way to handle that is to advertise it rather than fail at runtime. A surface
 * that offers "send to DMS" against a read-only integration teaches advisors
 * the product is broken.
 */
export interface DmsCapabilities {
  /** Vendor name for display: "Mock", "CDK Global", "Reynolds & Reynolds". */
  vendor: string
  canPullAppointments: boolean
  canPullCoverages: boolean
  canPullInspections: boolean
  canPullServiceHistory: boolean
  canPushHandOff: boolean
  canPushFollowUpOutcome: boolean
  /** True when writes go somewhere real rather than to a local log. */
  writesArePersisted: boolean
}
