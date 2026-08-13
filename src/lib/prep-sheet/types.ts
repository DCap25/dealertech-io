import type { Contract, OpenRecall, Payer, PrepaidEntitlement } from '@/lib/coverage'
import type { WarrantySnapshot } from '@/lib/warranty'

export type OpportunityType =
  | 'RECALL_OPEN'
  | 'DECLINED_SERVICE'
  | 'WEAR_PREDICTED'
  | 'MAINTENANCE_DUE'
  | 'PPM_UNUSED'
  | 'WARRANTY_EXPIRING'
  | 'CONTRACT_UPSELL'

/** Drives ranking far more than dollar value does. */
export type Urgency = 'SAFETY' | 'HIGH' | 'MEDIUM' | 'LOW'

export interface Opportunity {
  id: string
  type: OpportunityType
  title: string
  detail: string
  componentGroupKey?: string

  estimatedAmount: number
  /** After coverage and deductible. The number that decides whether they say yes. */
  customerOutOfPocket: number
  likelyPayer: Payer

  urgency: Urgency
  /** 0–1. Heuristic, tuned by out-of-pocket and by whether they already declined. */
  closeProbability: number
  priorityScore: number

  /** What the advisor should actually say. A task without one is just a chore. */
  talkTrack: string
  /** Row this came from — declined service, entitlement, recall campaign. */
  sourceId?: string
}

export interface PrepSheetVehicle {
  id: string
  vin: string
  make: string
  model: string | null
  modelYear: number
  inServiceDate: Date | null
  currentMileage: number
  avgMilesPerDay: number | null
  isHybridOrEv: boolean
  isOriginalOwner: boolean
}

export interface PrepSheetCustomer {
  id: string
  name: string
  visitCount: number
  lifetimeSpend: number
  lastVisitAt: Date | null
  preferredChannel: string
  pinnedNotes: string[]
}

export interface InspectionSnapshot {
  mileage: number
  recordedAt: Date
  items: {
    itemKey: string
    componentGroupKey: string | null
    value: number | null
    unit: string | null
    position: string | null
  }[]
}

export interface OpenDecline {
  id: string
  description: string
  componentGroupKey: string | null
  quotedAmount: number
  declinedAt: Date
  mileageAtDecline: number | null
}

export interface MaintenanceInterval {
  description: string
  componentGroupKey: string
  intervalMiles: number
  estimatedAmount: number
}

export interface PrepSheetInput {
  asOf: Date
  store: { state?: string; laborRate: number }
  customer: PrepSheetCustomer
  vehicle: PrepSheetVehicle
  appointment?: {
    id: string
    scheduledAt: Date
    promisedAt: Date | null
    transportType: string
    concerns: string | null
    advisorName: string | null
  }
  contracts: Contract[]
  prepaidEntitlements: (PrepaidEntitlement & { label: string })[]
  openDeclines: OpenDecline[]
  inspectionHistory: InspectionSnapshot[]
  openRecalls: (OpenRecall & { parkIt?: boolean; parkOutside?: boolean })[]
  maintenanceIntervals?: MaintenanceInterval[]
  /** Odometer at which each maintenance group was last performed. */
  lastServiceMileageByGroup?: Record<string, number>
}

export interface PrepSheet {
  customer: PrepSheetCustomer
  vehicle: PrepSheetVehicle
  appointment: PrepSheetInput['appointment']
  warranty: WarrantySnapshot
  /** Odometer projected to the appointment date, not the last known reading. */
  projectedMileage: number
  opportunities: Opportunity[]
  totals: {
    opportunityValue: number
    customerOutOfPocket: number
    coveredValue: number
  }
  /** Things that change what the advisor says at the podium. */
  alerts: string[]
}
