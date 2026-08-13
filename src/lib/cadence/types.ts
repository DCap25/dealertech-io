import type { Contract, PrepaidEntitlement } from '@/lib/coverage'

export type CadenceTrigger =
  | 'POST_VISIT_THANK_YOU'
  | 'CSI_PRE_EMPTION'
  | 'DECLINED_SERVICE_FOLLOW_UP'
  | 'MAINTENANCE_DUE_MILEAGE'
  | 'MAINTENANCE_DUE_TIME'
  | 'OEM_SCHEDULE_INTERVAL'
  | 'PPM_EXPIRING'
  | 'WARRANTY_EXPIRING'
  | 'CONTRACT_EXPIRING'
  | 'OPEN_RECALL'
  | 'STATE_INSPECTION_DUE'
  | 'SEASONAL'
  | 'DORMANT_CUSTOMER'
  | 'MISSED_APPOINTMENT'

export interface CadenceRule {
  id: string
  name: string
  trigger: CadenceTrigger
  /** Days after the triggering event. Negative fires ahead of a deadline. */
  offsetDays: number
  offsetMiles: number | null
  assignToRole: string | null
  talkTrack: string | null
  /** Minimum days between fires of this rule for the same customer. */
  cooldownDays: number
  priority: number
  isActive: boolean
}

/** A task this rule already produced, used to enforce cooldown. */
export interface ExistingTask {
  cadenceRuleId: string | null
  customerId: string
  vehicleId: string | null
  /** Distinguishes one declined line from another under the same rule. */
  sourceKey: string | null
  createdAt: Date
  status: string
}

export interface CadenceVehicle {
  id: string
  make: string
  model: string | null
  modelYear: number
  vin: string
  inServiceDate: Date | null
  currentMileage: number
  avgMilesPerDay: number | null
  isHybridOrEv: boolean
  isOriginalOwner: boolean
  contracts: Contract[]
  prepaidEntitlements: (PrepaidEntitlement & { label: string })[]
  openDeclines: {
    id: string
    description: string
    componentGroupKey: string | null
    quotedAmount: number
    declinedAt: Date
  }[]
  openRecalls: { campaignNumber: string; description: string; parkIt: boolean }[]
  /** Odometer at which each maintenance group was last performed. */
  lastServiceMileageByGroup: Record<string, number>
  /** Set when the vehicle already has an upcoming visit — suppresses most nudges. */
  nextAppointmentAt: Date | null
}

export interface CadenceCustomer {
  id: string
  name: string
  visitCount: number
  lifetimeSpend: number
  lastVisitAt: Date | null
  lastRoClosedAt: Date | null
  doNotCall: boolean
  smsConsent: boolean
  emailConsent: boolean
  preferredChannel: string
}

export interface CadenceContext {
  asOf: Date
  /** Only emit tasks due within this many days. Keeps the worklist actionable. */
  lookaheadDays?: number
  store: { state?: string; laborRate: number }
  customer: CadenceCustomer
  vehicles: CadenceVehicle[]
  rules: CadenceRule[]
  existingTasks: ExistingTask[]
}

export interface GeneratedTask {
  cadenceRuleId: string
  trigger: CadenceTrigger
  customerId: string
  vehicleId: string | null

  title: string
  detail: string
  talkTrack: string
  /** Revenue on the table, so a rep works highest-value first. */
  estimatedValue: number
  priority: number
  dueAt: Date
  assignToRole: string | null

  /** Stable identity for the thing that triggered it — used for dedupe. */
  sourceKey: string | null
  sourceDeclinedServiceId?: string
  /** Explains a suppression decision when one applies. */
  suppressedReason?: string
}
