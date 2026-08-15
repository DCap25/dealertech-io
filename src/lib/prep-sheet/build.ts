import { differenceInCalendarDays, differenceInCalendarMonths } from 'date-fns'
import { evaluateCoverage } from '@/lib/coverage'
import { computeWarrantySnapshot } from '@/lib/warranty'
import { getComponentGroup } from '@/lib/taxonomy'
import { predictWorstCorner, predictWear, TIRE_THRESHOLDS, BRAKE_THRESHOLDS, type WearReading } from './wear'
import { detectAlignment, type AxleReading } from './alignment'
import { resolvePrice } from './pricing'
import type {
  MaintenanceInterval, Opportunity, OpportunityType, PrepSheet, PrepSheetInput,
  PrepSheetVehicle, Urgency,
} from './types'

/**
 * The opportunity engine.
 *
 * Pure and I/O-free, like the coverage engine — it takes a vehicle's history
 * and returns a ranked list of what to sell, who pays, and what to say. The
 * screen is a thin renderer over this, and the nightly job that builds prep
 * sheets calls the same function.
 */

/** Ranking weights. Safety outranks money, and money outranks convenience. */
const URGENCY_WEIGHT: Record<Urgency, number> = {
  SAFETY: 1000,
  HIGH: 400,
  MEDIUM: 150,
  LOW: 50,
}

/** Sell tires this far ahead of the threshold rather than waiting for a complaint. */
const WEAR_HORIZON_MILES = 6000
const WARRANTY_UPSELL_MONTHS = 6
const WARRANTY_UPSELL_MILES = 8000
const PPM_EXPIRY_WARNING_DAYS = 90

/**
 * The service menu.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS AND IS NOT ON THIS LIST
 * ---------------------------------------------------------------------------
 * Everything here is a service that exists on the vehicles it is offered to,
 * on an interval a manufacturer or a reputable shop actually publishes. Two
 * kinds of thing are deliberately absent:
 *
 *  - Services whose applicability we cannot determine. A timing belt interval
 *    is meaningless on a chain engine and we have no per-engine data, so it is
 *    not here. Same for engine fuel filters, which are lifetime in-tank units
 *    on most modern petrol cars.
 *  - Wheel alignment, which is not a mileage service at all. It is recommended
 *    from evidence — uneven wear across the axle — further down this file.
 *
 * Adding something you cannot be right about is worse than leaving it off. An
 * advisor who has to delete a line before turning the tablet round stops
 * believing the rest of the menu, and so does the customer.
 */
const DEFAULT_INTERVALS: MaintenanceInterval[] = [
  // ------------------------------------------------------------ every visit
  { description: 'Oil & Filter Change', componentGroupKey: 'OIL_CHANGE', intervalMiles: 7500, estimatedAmount: 84, opCode: 'LOF',
    appliesTo: { combustionOnly: true } },
  { description: 'Tire Rotation', componentGroupKey: 'TIRE_ROTATION', intervalMiles: 7500, estimatedAmount: 29, opCode: 'ROT' },
  { description: 'Wiper Blade Replacement', componentGroupKey: 'WIPER_BLADES', intervalMiles: 15000, estimatedAmount: 62, opCode: 'WIPER' },
  { description: 'Tire Balance', componentGroupKey: 'TIRE_BALANCE', intervalMiles: 15000, estimatedAmount: 79, opCode: 'BAL' },

  // ---------------------------------------------------------------- filters
  { description: 'Engine Air Filter', componentGroupKey: 'ENGINE_AIR_FILTER', intervalMiles: 30000, estimatedAmount: 75, opCode: 'ENG-FLT',
    appliesTo: { combustionOnly: true } },
  { description: 'Cabin Air Filter', componentGroupKey: 'CABIN_AIR_FILTER', intervalMiles: 30000, estimatedAmount: 97, opCode: 'CAB-FLT' },

  // ----------------------------------------------------------------- fluids
  { description: 'Brake Fluid Exchange', componentGroupKey: 'BRAKE_FLUID_SERVICE', intervalMiles: 45000, estimatedAmount: 183, opCode: 'BRK-FLU' },
  { description: 'Transmission Fluid Service', componentGroupKey: 'TRANS_FLUID_SERVICE', intervalMiles: 60000, estimatedAmount: 367, opCode: 'TRANS-SVC',
    appliesTo: { combustionOnly: true } },
  /*
    An electric car does have coolant — it thermally manages the battery and
    the inverter — so this is not gated because the system is absent. It is
    gated because there is no generic EV interval to stand behind: Tesla lists
    none at all for the Model 3 and Y, and other makers scatter between 50,000
    and 150,000 miles. A 100,000-mile flush is a combustion-engine number, and
    quoting it at an owner who can pull up their own schedule in thirty seconds
    is the same invention the alignment rule exists to avoid.
  */
  { description: 'Coolant Flush', componentGroupKey: 'COOLANT_SERVICE', intervalMiles: 100000, estimatedAmount: 250, opCode: 'COOL-FL',
    appliesTo: { combustionOnly: true } },
  /*
    Hydraulic racks were near-universal until the early 2010s and are now rare
    — most cars sold since are electrically assisted and have no fluid at all.
    Capped by model year rather than offered to everyone.
  */
  { description: 'Power Steering Fluid Exchange', componentGroupKey: 'POWER_STEERING_PUMP', intervalMiles: 60000, estimatedAmount: 165, opCode: 'PS-FLU',
    appliesTo: { combustionOnly: true, maxModelYear: 2012 } },

  // ------------------------------------------------------------- driveline
  /*
    A front-wheel-drive car's differential lives inside the transaxle and is
    serviced with the transmission fluid. Only cars with a driven rear axle
    have a separate one to service.

    The combustion gate here is not about the engine. An electric car pairs its
    motor, reduction gearing and differential into one sealed drive unit filled
    for life — a rear-drive Model 3 has no serviceable diff and no transfer
    case, despite matching on driveline. Offering either is the same fabricated
    line item as quoting it spark plugs.
  */
  { description: 'Differential Fluid Service', componentGroupKey: 'DIFF_FLUID_SERVICE', intervalMiles: 45000, estimatedAmount: 189, opCode: 'DIFF-SVC',
    appliesTo: { combustionOnly: true, driveTypes: ['RWD', 'AWD', 'FOUR_WD'] } },
  { description: 'Transfer Case Fluid Service', componentGroupKey: 'TRANSFER_CASE', intervalMiles: 45000, estimatedAmount: 169, opCode: 'TCASE-SVC',
    appliesTo: { combustionOnly: true, driveTypes: ['AWD', 'FOUR_WD'] } },

  // ----------------------------------------------------------------- engine
  { description: 'Fuel System Induction Service', componentGroupKey: 'FUEL_INDUCTION_SERVICE', intervalMiles: 30000, estimatedAmount: 199, opCode: 'IND-SVC',
    appliesTo: { combustionOnly: true } },
  { description: 'PCV Valve Replacement', componentGroupKey: 'PCV_SYSTEM', intervalMiles: 60000, estimatedAmount: 120, opCode: 'PCV',
    appliesTo: { combustionOnly: true } },
  { description: 'Serpentine Belt Replacement', componentGroupKey: 'ACCESSORY_DRIVE', intervalMiles: 90000, estimatedAmount: 210, opCode: 'BELT',
    appliesTo: { combustionOnly: true } },
  { description: 'Spark Plug Replacement', componentGroupKey: 'SPARK_PLUGS', intervalMiles: 100000, estimatedAmount: 535, opCode: 'PLUGS',
    appliesTo: { combustionOnly: true } },
]

/**
 * Does this service exist on this vehicle at all?
 *
 * Unknown driveline means skip, not guess. A menu that quietly drops a
 * differential service we were not sure about costs one line; a menu that
 * offers a transfer case service on a Camry costs the advisor the room.
 */
export function intervalApplies(
  interval: MaintenanceInterval,
  vehicle: PrepSheetVehicle,
): boolean {
  const rules = interval.appliesTo
  if (!rules) return true

  if (rules.combustionOnly && vehicle.isFullyElectric) return false
  if (rules.maxModelYear !== undefined && vehicle.modelYear > rules.maxModelYear) return false
  if (rules.driveTypes) {
    if (!vehicle.driveType) return false
    if (!rules.driveTypes.includes(vehicle.driveType)) return false
  }
  return true
}

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

/**
 * Priority score.
 *
 * The non-obvious term is the out-of-pocket bonus: a $900 tire set that the
 * customer's road-hazard policy pays for outranks a $900 tire set they owe in
 * full, because the first is an easy yes and the second is a negotiation.
 */
function score(o: Omit<Opportunity, 'priorityScore' | 'id'>): number {
  const urgency = URGENCY_WEIGHT[o.urgency]
  const value = Math.min(o.estimatedAmount, 3000) / 10
  const close = o.closeProbability * 200

  let pocketBonus = 0
  if (o.customerOutOfPocket <= 0) pocketBonus = 150
  else if (o.estimatedAmount > 0 && o.customerOutOfPocket / o.estimatedAmount < 0.25) pocketBonus = 75

  return Math.round(urgency + value + close + pocketBonus)
}

function urgencyForComponent(componentGroupKey: string | null | undefined): Urgency {
  if (!componentGroupKey) return 'MEDIUM'
  const group = getComponentGroup(componentGroupKey)
  if (!group) return 'MEDIUM'
  if (group.system === 'BRAKES' || group.system === 'TIRES_WHEELS' || group.system === 'STEERING') return 'HIGH'
  if (group.system === 'SAFETY_ADAS') return 'HIGH'
  if (group.maintenanceItem) return 'LOW'
  return 'MEDIUM'
}

export function buildPrepSheet(input: PrepSheetInput): PrepSheet {
  const { asOf, vehicle, customer, store } = input
  const alerts: string[] = []
  const raw: Omit<Opportunity, 'priorityScore' | 'id'>[] = []

  // ---- Project the odometer to the appointment, not the last known reading.
  const daysAhead = input.appointment
    ? Math.max(0, differenceInCalendarDays(input.appointment.scheduledAt, asOf))
    : 0
  const projectedMileage = Math.round(
    vehicle.currentMileage + (vehicle.avgMilesPerDay ?? 0) * daysAhead,
  )

  /*
    Raised first, because it undermines everything below it. Every coverage
    determination on this sheet keys off the odometer, so if the source system
    contradicted itself about what that is, the advisor should read that before
    they read the numbers it produced.
  */
  if (input.odometerNote) alerts.push(input.odometerNote)

  const warranty = computeWarrantySnapshot({
    make: vehicle.make,
    modelYear: vehicle.modelYear,
    inServiceDate: vehicle.inServiceDate ?? new Date(vehicle.modelYear, 0, 1),
    currentMileage: projectedMileage,
    asOf,
    isOriginalOwner: vehicle.isOriginalOwner,
    isHybridOrEv: vehicle.isHybridOrEv,
    state: store.state,
  })

  /** Runs the coverage engine so every line knows who actually pays. */
  const coverageFor = (description: string, componentGroupKey: string | null, amount: number) =>
    evaluateCoverage({
      vehicle: {
        vin: vehicle.vin, make: vehicle.make, model: vehicle.model ?? undefined,
        modelYear: vehicle.modelYear,
        inServiceDate: vehicle.inServiceDate ?? new Date(vehicle.modelYear, 0, 1),
        currentMileage: projectedMileage,
        isHybridOrEv: vehicle.isHybridOrEv,
        isOriginalOwner: vehicle.isOriginalOwner,
      },
      operation: {
        description,
        componentGroupKey: componentGroupKey ?? undefined,
        laborAmount: amount * 0.55,
        partsAmount: amount * 0.45,
      },
      contracts: input.contracts,
      prepaidEntitlements: input.prepaidEntitlements,
      openRecalls: input.openRecalls,
      store: { laborRate: store.laborRate, state: store.state },
      history: { visitCount: customer.visitCount, lifetimeSpend: customer.lifetimeSpend },
      asOf,
    })

  // ------------------------------------------------------- 1. open recalls
  for (const recall of input.openRecalls) {
    if (recall.parkIt) {
      alerts.push(
        `DO NOT DRIVE advisory on campaign ${recall.campaignNumber}. Arrange transport and do not release the vehicle.`,
      )
    } else if (recall.parkOutside) {
      alerts.push(`PARK OUTSIDE advisory on campaign ${recall.campaignNumber} — fire risk while parked.`)
    }
    raw.push({
      type: 'RECALL_OPEN',
      title: `Recall ${recall.campaignNumber}`,
      detail: recall.description || 'Manufacturer campaign applies to this make, model and year.',
      componentGroupKey: recall.componentGroupKeys[0],
      estimatedAmount: 0,
      customerOutOfPocket: 0,
      likelyPayer: 'OEM_RECALL',
      urgency: recall.parkIt ? 'SAFETY' : 'HIGH',
      closeProbability: 0.9,
      talkTrack: recall.isCandidate
        ? `Verify campaign ${recall.campaignNumber} is open for this VIN in the OEM portal, then tell the customer it is free and takes one appointment.`
        : `Campaign ${recall.campaignNumber} is open and manufacturer-funded. Book it alongside today's work.`,
      sourceId: recall.campaignNumber,
    })
  }

  // -------------------------------------------------- 2. declined services
  for (const decline of input.openDeclines) {
    const monthsAgo = differenceInCalendarMonths(asOf, decline.declinedAt)
    const determination = coverageFor(decline.description, decline.componentGroupKey, decline.quotedAmount)
    const covered = determination.payer !== 'CUSTOMER_PAY'
    const urgency = urgencyForComponent(decline.componentGroupKey)

    raw.push({
      type: 'DECLINED_SERVICE',
      title: decline.description,
      detail: `Declined ${monthsAgo <= 0 ? 'this month' : `${monthsAgo} month${monthsAgo === 1 ? '' : 's'} ago`}` +
        `${decline.mileageAtDecline ? ` at ${decline.mileageAtDecline.toLocaleString()} miles` : ''}` +
        ` — quoted ${money(decline.quotedAmount)}.`,
      componentGroupKey: decline.componentGroupKey ?? undefined,
      estimatedAmount: decline.quotedAmount,
      customerOutOfPocket: determination.customerOutOfPocket,
      likelyPayer: determination.payer,
      urgency,
      // They already said no once, so temper expectations — unless coverage now
      // pays for it, which is a genuinely different conversation.
      closeProbability: covered ? 0.7 : urgency === 'HIGH' ? 0.4 : 0.3,
      talkTrack: covered
        ? `They declined this before at ${money(decline.quotedAmount)}. It is now covered — their cost is ${money(determination.customerOutOfPocket)}. Lead with that.`
        : `Reference the exact item and how long it has been outstanding. Lead with safety, not discount.`,
      sourceId: decline.id,
    })
  }

  // ------------------------------------------------------ 3. wear prediction
  const treadByPosition = new Map<string, WearReading[]>()
  const brakeReadings: WearReading[] = []
  for (const inspection of input.inspectionHistory) {
    for (const item of inspection.items) {
      if (item.value === null) continue
      const reading: WearReading = {
        mileage: inspection.mileage,
        value: item.value,
        recordedAt: inspection.recordedAt,
      }
      if (item.componentGroupKey === 'TIRES' && item.position) {
        treadByPosition.set(item.position, [...(treadByPosition.get(item.position) ?? []), reading])
      } else if (item.componentGroupKey === 'BRAKE_PADS_SHOES') {
        brakeReadings.push(reading)
      }
    }
  }

  /**
   * Alignment, from evidence rather than from a schedule.
   *
   * Uses the newest reading per corner, since the question is what the tyres
   * look like today — not how they have trended.
   */
  const latestPerCorner: AxleReading[] = []
  for (const [position, readings] of treadByPosition) {
    const newest = readings.reduce((a, b) => (b.mileage > a.mileage ? b : a))
    latestPerCorner.push({ position, value: newest.value })
  }
  const alignment = detectAlignment(latestPerCorner)
  if (alignment) {
    const { amount, source: priceSource } = resolvePrice(input.priceBook, 'ALIGN', 149)
    const determination = coverageFor('four wheel alignment', 'WHEEL_ALIGNMENT', amount)
    raw.push({
      type: 'MAINTENANCE_DUE',
      title: 'Four Wheel Alignment',
      detail: alignment.detail,
      customerDetail: alignment.detail,
      componentGroupKey: 'WHEEL_ALIGNMENT',
      estimatedAmount: amount,
      priceSource,
      customerOutOfPocket: determination.customerOutOfPocket,
      likelyPayer: determination.payer,
      // Not a safety item — the car drives straight. It is a tyre-life
      // argument, and overstating it is how the whole menu loses credibility.
      urgency: 'MEDIUM',
      closeProbability: 0.4,
      talkTrack:
        `Show them the two numbers. ${alignment.detail} Alignment costs a fraction of the ` +
        `set of tyres it saves, and the car may drive perfectly straight the whole time.`,
    })
  }

  const worstTire = predictWorstCorner(treadByPosition, TIRE_THRESHOLDS, vehicle.avgMilesPerDay)
  if (worstTire) {
    const { prediction, position } = worstTire
    const dueNow = prediction.isAtSellThreshold
    const dueSoon =
      prediction.milesUntilSellThreshold !== null &&
      prediction.milesUntilSellThreshold <= WEAR_HORIZON_MILES
    if (dueNow || dueSoon) {
      const { amount, source: priceSource } = resolvePrice(input.priceBook, 'TIRE4', 1100)
      const determination = coverageFor('replace tires road hazard', 'TIRES', amount)
      raw.push({
        type: 'WEAR_PREDICTED',
        title: 'Tires approaching replacement',
        detail: prediction.isCritical
          ? `Worst corner ${position} is at ${prediction.currentValue}/32" — at or below the legal minimum.`
          : dueNow
            ? `Worst corner ${position} is at ${prediction.currentValue}/32", already at the ${TIRE_THRESHOLDS.sell}/32" sell point.`
            : `Worst corner ${position} at ${prediction.currentValue}/32", wearing ${prediction.ratePerThousandMiles}/32" per 1,000 miles — reaches ${TIRE_THRESHOLDS.sell}/32" in about ${prediction.milesUntilSellThreshold?.toLocaleString()} miles.`,
        componentGroupKey: 'TIRES',
        estimatedAmount: amount,
        priceSource,
        customerOutOfPocket: determination.customerOutOfPocket,
        likelyPayer: determination.payer,
        urgency: prediction.isCritical ? 'SAFETY' : 'HIGH',
        closeProbability: determination.customerOutOfPocket === 0 ? 0.75 : dueNow ? 0.5 : 0.3,
        talkTrack: prediction.isCritical
          ? `Show them the ${prediction.currentValue}/32" measurement. This is a legal and safety issue, not a preference.`
          : `Show the trend across their last ${prediction.readingCount} visits. They can plan for it now or be surprised by it later.`,
      })
    }
  }

  const brakePrediction = predictWear(brakeReadings, BRAKE_THRESHOLDS, vehicle.avgMilesPerDay)
  if (brakePrediction && (brakePrediction.isAtSellThreshold ||
      (brakePrediction.milesUntilSellThreshold !== null && brakePrediction.milesUntilSellThreshold <= WEAR_HORIZON_MILES))) {
    const { amount, source: priceSource } = resolvePrice(input.priceBook, 'BRK-FR', 618)
    const determination = coverageFor('front brake pads and rotors', 'BRAKE_PADS_SHOES', amount)
    raw.push({
      type: 'WEAR_PREDICTED',
      title: 'Front brakes approaching replacement',
      detail: `Pads at ${brakePrediction.currentValue}mm` +
        (brakePrediction.milesUntilSellThreshold
          ? `, wearing ${brakePrediction.ratePerThousandMiles}mm per 1,000 miles — reaches ${BRAKE_THRESHOLDS.sell}mm in about ${brakePrediction.milesUntilSellThreshold.toLocaleString()} miles.`
          : '.'),
      componentGroupKey: 'BRAKE_PADS_SHOES',
      estimatedAmount: amount,
      priceSource,
      customerOutOfPocket: determination.customerOutOfPocket,
      likelyPayer: determination.payer,
      urgency: brakePrediction.isCritical ? 'SAFETY' : 'HIGH',
      closeProbability: brakePrediction.isCritical ? 0.6 : 0.4,
      talkTrack: `Pads measured at ${brakePrediction.currentValue}mm. Show the measurement — brakes sell on evidence, not opinion.`,
    })
  }

  // ------------------------------------------------- 4. maintenance due
  const intervals = (input.maintenanceIntervals ?? DEFAULT_INTERVALS).filter((interval) =>
    intervalApplies(interval, input.vehicle),
  )
  /**
   * How short an interval has to be before "no record" can be shrugged off.
   *
   * With no history, something has to be assumed. For an oil change or a tyre
   * rotation, assuming the customer has broadly kept up is fair — the car is
   * running, and these get done everywhere from quick-lube to the driveway. So
   * the next boundary above the current odometer is a reasonable next-due.
   *
   * That same assumption applied to a 45,000-mile brake fluid exchange asserts
   * something we have no basis for. Those are handled in the second pass below,
   * as questions rather than as recommendations.
   */
  const ASSUME_KEPT_UP_BELOW = 30_000

  /**
   * Services with a known last-done odometer, plus the short-interval services
   * we are willing to assume have been kept up.
   */
  for (const interval of intervals) {
    const lastAt = input.lastServiceMileageByGroup?.[interval.componentGroupKey]
    const hasRecord = lastAt !== undefined
    if (!hasRecord && interval.intervalMiles >= ASSUME_KEPT_UP_BELOW) continue

    const dueAt = hasRecord
      ? lastAt + interval.intervalMiles
      : Math.ceil(Math.max(projectedMileage, 1) / interval.intervalMiles) * interval.intervalMiles
    // Only interesting if due now or within the next couple of thousand miles.
    if (projectedMileage < dueAt - 2000) continue

    const { amount: price, source: priceSource } = resolvePrice(input.priceBook, interval.opCode, interval.estimatedAmount)
    const determination = coverageFor(interval.description, interval.componentGroupKey, price)
    const overdueBy = projectedMileage - dueAt

    const detail = !hasRecord
      ? `Every ${interval.intervalMiles.toLocaleString()} miles. No record on file, so the next one is taken as ${dueAt.toLocaleString()} — confirm with the customer.`
      : overdueBy >= 0
        ? `Overdue by ${overdueBy.toLocaleString()} miles — last done at ${lastAt.toLocaleString()}, projected ${projectedMileage.toLocaleString()} at arrival.`
        : `Due at ${dueAt.toLocaleString()} miles, ${Math.abs(overdueBy).toLocaleString()} away.`

    raw.push({
      type: 'MAINTENANCE_DUE',
      title: interval.description,
      detail,
      // The advisor version says "confirm with the customer". Fine to read at
      // the podium, not fine to hand across on a tablet.
      customerDetail: hasRecord
        ? detail
        : `Recommended every ${interval.intervalMiles.toLocaleString()} miles.`,
      componentGroupKey: interval.componentGroupKey,
      estimatedAmount: price,
      priceSource,
      customerOutOfPocket: determination.customerOutOfPocket,
      likelyPayer: determination.payer,
      urgency: hasRecord && overdueBy > interval.intervalMiles * 0.5 ? 'MEDIUM' : 'LOW',
      closeProbability: determination.payer === 'PPM' ? 0.85 : hasRecord ? 0.5 : 0.35,
      talkTrack: determination.payer === 'PPM'
        ? `Already paid for on their prepaid plan. Redeem it today.`
        : hasRecord
          ? `Present with the mileage. Bundling it with today's visit saves them a trip.`
          : `Confirm when this was last done before presenting it as due.`,
    })
  }

  /**
   * The long-interval services, where we have no record at all.
   *
   * ---------------------------------------------------------------------------
   * WHY THIS IS ITS OWN PASS
   * ---------------------------------------------------------------------------
   * Every interval used to assume the next boundary above the current odometer,
   * which quietly asserts that all the earlier ones were met. On a 7,500-mile
   * oil change that is a safe bet, and the pass above still makes it. On a
   * 45,000-mile brake fluid exchange it means a car at 92,000 miles with no
   * record anywhere is told its fluid is due at 135,000 — which is why the
   * flushes and driveline services almost never reached a sheet.
   *
   * What we can honestly say here is narrower: this is an N-mile service, the
   * car is past N, and we have not seen it done. That is a question for the
   * customer, not a recommendation, and it is worded and ranked as one.
   *
   * A vehicle with no history at all qualifies for every long interval at once,
   * which is a lot of lines. They are not capped: LOW urgency sinks them below
   * everything measured, and the advisor picks what reaches the tablet in the
   * menu builder. Truncating instead would mean either hiding items silently or
   * raising an alert for something that is not one, and the red alert band is
   * spent on park-it recalls — putting a maintenance footnote in it teaches
   * advisors to skim past the band that matters.
   */
  const unrecorded = intervals
    .filter((interval) => interval.intervalMiles >= ASSUME_KEPT_UP_BELOW)
    .filter((interval) => input.lastServiceMileageByGroup?.[interval.componentGroupKey] === undefined)
    .filter((interval) => projectedMileage >= interval.intervalMiles)

  for (const interval of unrecorded) {
    const { amount: price, source: priceSource } = resolvePrice(input.priceBook, interval.opCode, interval.estimatedAmount)
    const determination = coverageFor(interval.description, interval.componentGroupKey, price)

    raw.push({
      type: 'MAINTENANCE_DUE',
      title: interval.description,
      detail:
        `${interval.intervalMiles.toLocaleString()}-mile service with no record on file. ` +
        `Vehicle projects to ${projectedMileage.toLocaleString()} at arrival — ask when it was last done ` +
        `before recommending it.`,
      // The advisor version tells them to ask. Turning the tablet round must
      // not show the customer our own instruction to interrogate them.
      customerDetail: `Recommended every ${interval.intervalMiles.toLocaleString()} miles.`,
      componentGroupKey: interval.componentGroupKey,
      estimatedAmount: price,
      priceSource,
      customerOutOfPocket: determination.customerOutOfPocket,
      likelyPayer: determination.payer,
      // An unverified interval is a question. It never outranks a measurement,
      // and it stays off the customer's menu until the advisor has asked.
      unverified: true,
      urgency: 'LOW',
      closeProbability: determination.payer === 'PPM' ? 0.85 : 0.3,
      talkTrack: determination.payer === 'PPM'
        ? `Already paid for on their prepaid plan. Redeem it today.`
        : `Ask when this was last done before recommending it — guessing damages trust.`,
    })
  }

  // -------------------------------------------------- 5. prepaid maintenance
  for (const entitlement of input.prepaidEntitlements) {
    const remaining = entitlement.totalAllowed - entitlement.used
    if (remaining <= 0) continue
    const daysToExpiry = entitlement.expiresOn
      ? differenceInCalendarDays(entitlement.expiresOn, asOf)
      : null
    const expiringSoon = daysToExpiry !== null && daysToExpiry <= PPM_EXPIRY_WARNING_DAYS

    raw.push({
      type: 'PPM_UNUSED',
      title: `${remaining} prepaid ${entitlement.label} remaining`,
      detail: expiringSoon
        ? `Plan expires in ${daysToExpiry} days with ${remaining} visit${remaining === 1 ? '' : 's'} unused. Use it or lose it.`
        : `${remaining} of ${entitlement.totalAllowed} visits remaining on the prepaid plan.`,
      componentGroupKey: entitlement.componentGroupKey,
      estimatedAmount: 0,
      customerOutOfPocket: 0,
      likelyPayer: 'PPM',
      urgency: expiringSoon ? 'HIGH' : 'LOW',
      closeProbability: 0.9,
      talkTrack: expiringSoon
        ? `They already paid for these. Book the next visit before the plan expires — this is free goodwill and a guaranteed return trip.`
        : `Remind them the plan covers this. Prepaid visits are the cheapest way to keep them coming back.`,
      sourceId: entitlement.contractId,
    })
  }

  // ------------------------------------------------ 6. warranty expiring
  const basic = warranty.basic
  const powertrain = warranty.powertrain
  const nearest = [basic, powertrain].filter((t) => t?.active)
  const hasVsc = input.contracts.some((c) => c.productType === 'VSC' && c.status === 'ACTIVE')
  for (const term of nearest) {
    if (!term) continue
    const monthsLeft = term.monthsRemaining
    const milesLeft = term.milesRemaining
    const closing =
      (monthsLeft !== null && monthsLeft <= WARRANTY_UPSELL_MONTHS) ||
      (milesLeft !== null && milesLeft <= WARRANTY_UPSELL_MILES)
    if (!closing || hasVsc) continue

    raw.push({
      type: 'WARRANTY_EXPIRING',
      title: `${term.name} ending soon`,
      detail: `${monthsLeft ?? '∞'} months and ${milesLeft?.toLocaleString() ?? '∞'} miles remaining, with no service contract on file.`,
      estimatedAmount: 2400,
      customerOutOfPocket: 2400,
      likelyPayer: 'CUSTOMER_PAY',
      urgency: 'MEDIUM',
      closeProbability: 0.25,
      talkTrack: `Their factory coverage is about to end. This is the moment a service contract is easiest to justify — after it lapses, the conversation is much harder.`,
    })
    break
  }

  // ------------------------------------------------- 7. product gaps
  const hasTireWheel = input.contracts.some((c) => c.productType === 'TIRE_WHEEL' && c.status === 'ACTIVE')
  if (!hasTireWheel && worstTire && worstTire.prediction.currentValue > TIRE_THRESHOLDS.sell) {
    raw.push({
      type: 'CONTRACT_UPSELL',
      title: 'No tire & wheel coverage on file',
      detail: `Tires still have life at ${worstTire.prediction.currentValue}/32", which is exactly when a road hazard policy can still be written.`,
      estimatedAmount: 795,
      customerOutOfPocket: 795,
      likelyPayer: 'CUSTOMER_PAY',
      urgency: 'LOW',
      closeProbability: 0.2,
      talkTrack: `Sell it while the tires are healthy — most policies will not write over worn tires. One road hazard claim pays for it.`,
    })
  }

  // --------------------------------------------------------- CSI context
  if (customer.lastVisitAt) {
    const daysSince = differenceInCalendarDays(asOf, customer.lastVisitAt)
    if (daysSince > 400) {
      alerts.push(`First visit in ${Math.round(daysSince / 30)} months — treat this as a win-back, not a routine RO.`)
    }
  }
  for (const note of customer.pinnedNotes) alerts.push(note)
  if (!warranty.known) {
    alerts.push(`No factory warranty reference data for ${vehicle.make}. Verify coverage in the OEM portal.`)
  }

  // ------------------------------------------------------------ rank
  const opportunities: Opportunity[] = raw
    .map((o, index) => ({ ...o, id: `${o.type}-${index}`, priorityScore: score(o) }))
    .sort((a, b) => b.priorityScore - a.priorityScore)

  const opportunityValue = opportunities.reduce((sum, o) => sum + o.estimatedAmount, 0)
  const customerOutOfPocket = opportunities.reduce((sum, o) => sum + o.customerOutOfPocket, 0)

  return {
    customer,
    vehicle,
    appointment: input.appointment,
    warranty,
    contracts: input.contracts,
    prepaidEntitlements: input.prepaidEntitlements,
    inspectionHistory: input.inspectionHistory,
    projectedMileage,
    opportunities,
    totals: {
      opportunityValue,
      customerOutOfPocket,
      coveredValue: opportunityValue - customerOutOfPocket,
    },
    alerts,
  }
}

export { DEFAULT_INTERVALS }
export type { OpportunityType }
