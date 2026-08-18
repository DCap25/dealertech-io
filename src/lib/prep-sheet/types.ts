import type { Contract, OpenRecall, Payer, PrepaidEntitlement } from '@/lib/coverage'
import type { WarrantySnapshot } from '@/lib/warranty'
import type { PriceBook } from './pricing'

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
  /**
   * Wording safe to show the customer, when `detail` carries instructions
   * meant for the advisor. Turning the tablet around must never expose
   * "confirm history with the customer".
   */
  customerDetail?: string
  /** Row this came from — declined service, entitlement, recall campaign. */
  sourceId?: string
  /**
   * Whether this price is the store's own or our estimate.
   *
   * An advisor about to turn a tablet round should be able to tell the
   * difference. "Your op code says $106" and "we think it's about $84" are
   * different degrees of confidence, and only one of them is safe to defend to
   * a customer.
   */
  priceSource?: 'STORE' | 'ESTIMATE'
  /**
   * We inferred this rather than observed it, and it needs a word with the
   * customer before it is presented as due.
   *
   * Set on interval services we have no service record for. The vehicle is past
   * the interval and we have not seen the work done — but "we have no record"
   * and "it is due" are different statements, and only the customer can close
   * the gap. Items marked this way stay off the customer menu by default.
   */
  unverified?: boolean
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
  /**
   * Null when the source system does not say. Driveline services are skipped
   * rather than guessed at — a transfer case service on a front-wheel-drive
   * car is worse than an omission.
   */
  driveType?: DriveType | null
  /** True for battery-electric. A hybrid still has an engine to service. */
  isFullyElectric?: boolean
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
  /**
   * What they were told it cost on the day they said no.
   *
   * History, not a price. It is worth saying out loud at the podium — and it is
   * the fallback when nothing else can price the work — but the number the
   * customer is quoted comes from the price book, like every other line.
   */
  quotedAmount: number
  /**
   * The store operation this work would be billed under today.
   *
   * Absent on anything recorded before the field existed, and on imports from a
   * system that does not carry one. Absent means the price falls through to the
   * old quote marked `ESTIMATE`, which keeps it off the customer's menu until an
   * advisor has priced it rather than quoting a stale figure as firm.
   */
  opCode?: string | null
  declinedAt: Date
  mileageAtDecline: number | null
}

/** How the wheels are driven. Decides which driveline services exist at all. */
export type DriveType = 'FWD' | 'RWD' | 'AWD' | 'FOUR_WD'

export interface MaintenanceInterval {
  description: string
  componentGroupKey: string
  intervalMiles: number
  /**
   * The engine's own figure, used when the store has no matching op code.
   *
   * A fallback rather than the price: a recommendation that vanished because
   * its price was missing would be worse than one priced approximately.
   */
  estimatedAmount: number
  /**
   * The store op code this recommendation means.
   *
   * Named explicitly rather than matched on component group, because a group
   * is not specific enough — front and rear brakes share BRAKE_PADS_SHOES and
   * cost different money.
   */
  opCode?: string

  /**
   * Vehicles this service does not exist on.
   *
   * An electric car has no spark plugs and a front-wheel-drive car has no
   * transfer case. Putting either on a menu is a visible, checkable error —
   * and an advisor who has to delete a line before turning the tablet round
   * stops trusting the rest of it.
   *
   * Absent means it applies to everything.
   */
  appliesTo?: {
    /** Skip on battery-electric vehicles. */
    combustionOnly?: boolean
    /** Only on these drivelines. Skipped when the driveline is unknown. */
    driveTypes?: DriveType[]
    /**
     * Newest model year this is offered for. Used where a system was phased
     * out — hydraulic power steering, for one — and recommending it on a car
     * that never had it is wrong rather than merely unnecessary.
     */
    maxModelYear?: number
  }
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
    /**
     * Whose book this visit sits on. Nullable — an unassigned appointment is
     * the pool an advisor claims from at write-up. Carried for the week views
     * (DRIVE_PLAN D2: the schedule is the advisor's book); the DMS wire type
     * always had it and the mapper used to drop it.
     */
    advisorId?: string | null
    /** Appointment lifecycle status as the source system reports it. */
    status?: string
    /**
     * `FIRST_SERVICE` when this visit came from a delivery introduction
     * (DRIVE_PLAN D5), null otherwise — which is nearly always.
     *
     * Optional and additive for the same reason `advisorId` and `status` were:
     * every engine test builds this object by hand, and a required field would
     * make a hundred fixtures wrong about a fact none of them are testing.
     */
    visitContext?: string | null
    /** The salesperson who sold the car and walked them over. */
    soldByName?: string | null
    /** The advisor they were introduced to at delivery. */
    introducedAdvisorName?: string | null
  }
  contracts: Contract[]
  prepaidEntitlements: (PrepaidEntitlement & { label: string })[]
  openDeclines: OpenDecline[]
  inspectionHistory: InspectionSnapshot[]
  openRecalls: (OpenRecall & { parkIt?: boolean; parkOutside?: boolean })[]
  maintenanceIntervals?: MaintenanceInterval[]
  /** Odometer at which each maintenance group was last performed. */
  lastServiceMileageByGroup?: Record<string, number>
  /**
   * Set when the source system's odometer contradicted its own history and the
   * mapping layer used a different figure.
   *
   * Carried through to the sheet as an alert rather than applied silently: an
   * import has nobody to ask, so the correction has to reach the one person who
   * can look at the actual cluster.
   */
  odometerNote?: string
  /**
   * The store's priced operations, keyed by op code.
   *
   * Absent means every recommendation falls back to the engine's estimate,
   * which is what happens on an integration with no price book. Present means
   * the customer is quoted this dealership's actual money.
   */
  priceBook?: PriceBook
}

export interface PrepSheet {
  customer: PrepSheetCustomer
  vehicle: PrepSheetVehicle
  appointment: PrepSheetInput['appointment']
  warranty: WarrantySnapshot
  /**
   * Passed straight through so the UI can render the products a customer owns
   * alongside factory warranty. Data only — no decision is made from it here;
   * the coverage engine remains the sole authority on who pays.
   */
  contracts: Contract[]
  prepaidEntitlements: (PrepaidEntitlement & { label: string })[]
  /**
   * Raw measurement history, passed straight through so the UI can chart the
   * same series the wear engine fitted. Data only — the engine remains the
   * sole authority on rates and projections.
   */
  inspectionHistory: InspectionSnapshot[]
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
