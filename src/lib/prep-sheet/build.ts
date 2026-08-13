import { differenceInCalendarDays, differenceInCalendarMonths } from 'date-fns'
import { evaluateCoverage, type Payer } from '@/lib/coverage'
import { computeWarrantySnapshot } from '@/lib/warranty'
import { getComponentGroup } from '@/lib/taxonomy'
import { predictWorstCorner, predictWear, TIRE_THRESHOLDS, BRAKE_THRESHOLDS, type WearReading } from './wear'
import type {
  MaintenanceInterval, Opportunity, OpportunityType, PrepSheet, PrepSheetInput, Urgency,
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

const DEFAULT_INTERVALS: MaintenanceInterval[] = [
  { description: 'Oil & Filter Change', componentGroupKey: 'OIL_CHANGE', intervalMiles: 7500, estimatedAmount: 84 },
  { description: 'Tire Rotation', componentGroupKey: 'TIRE_ROTATION', intervalMiles: 7500, estimatedAmount: 29 },
  { description: 'Engine Air Filter', componentGroupKey: 'ENGINE_AIR_FILTER', intervalMiles: 30000, estimatedAmount: 75 },
  { description: 'Cabin Air Filter', componentGroupKey: 'CABIN_AIR_FILTER', intervalMiles: 30000, estimatedAmount: 97 },
  { description: 'Brake Fluid Exchange', componentGroupKey: 'BRAKE_FLUID_SERVICE', intervalMiles: 45000, estimatedAmount: 183 },
  { description: 'Transmission Fluid Service', componentGroupKey: 'TRANS_FLUID_SERVICE', intervalMiles: 60000, estimatedAmount: 367 },
  { description: 'Spark Plug Replacement', componentGroupKey: 'SPARK_PLUGS', intervalMiles: 100000, estimatedAmount: 535 },
  { description: 'Coolant Flush', componentGroupKey: 'COOLANT_SERVICE', intervalMiles: 100000, estimatedAmount: 250 },
]

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

  const worstTire = predictWorstCorner(treadByPosition, TIRE_THRESHOLDS, vehicle.avgMilesPerDay)
  if (worstTire) {
    const { prediction, position } = worstTire
    const dueNow = prediction.isAtSellThreshold
    const dueSoon =
      prediction.milesUntilSellThreshold !== null &&
      prediction.milesUntilSellThreshold <= WEAR_HORIZON_MILES
    if (dueNow || dueSoon) {
      const amount = 1100
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
    const amount = 618
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
      customerOutOfPocket: determination.customerOutOfPocket,
      likelyPayer: determination.payer,
      urgency: brakePrediction.isCritical ? 'SAFETY' : 'HIGH',
      closeProbability: brakePrediction.isCritical ? 0.6 : 0.4,
      talkTrack: `Pads measured at ${brakePrediction.currentValue}mm. Show the measurement — brakes sell on evidence, not opinion.`,
    })
  }

  // ------------------------------------------------- 4. maintenance due
  const intervals = input.maintenanceIntervals ?? DEFAULT_INTERVALS
  for (const interval of intervals) {
    const lastAt = input.lastServiceMileageByGroup?.[interval.componentGroupKey]
    const hasRecord = lastAt !== undefined

    /**
     * With no record of the service ever being done, assume the NEXT interval
     * boundary rather than treating it as overdue since zero. Defaulting to
     * zero made every interval read "overdue by 100,000 miles" on an older
     * vehicle, which buries the items that genuinely matter.
     */
    const dueAt = hasRecord
      ? lastAt + interval.intervalMiles
      : Math.ceil(Math.max(projectedMileage, 1) / interval.intervalMiles) * interval.intervalMiles

    // Only interesting if due now or within the next couple of thousand miles.
    if (projectedMileage < dueAt - 2000) continue

    const determination = coverageFor(interval.description, interval.componentGroupKey, interval.estimatedAmount)
    const overdueBy = projectedMileage - dueAt

    const detail = !hasRecord
      ? `No record of this service. Next interval falls at ${dueAt.toLocaleString()} miles — confirm history with the customer.`
      : overdueBy >= 0
        ? `Overdue by ${overdueBy.toLocaleString()} miles — last done at ${lastAt.toLocaleString()}, projected ${projectedMileage.toLocaleString()} at arrival.`
        : `Due at ${dueAt.toLocaleString()} miles, ${Math.abs(overdueBy).toLocaleString()} away.`

    raw.push({
      type: 'MAINTENANCE_DUE',
      title: interval.description,
      detail,
      componentGroupKey: interval.componentGroupKey,
      estimatedAmount: interval.estimatedAmount,
      customerOutOfPocket: determination.customerOutOfPocket,
      likelyPayer: determination.payer,
      // An unverified interval is a question, not a recommendation.
      urgency: !hasRecord ? 'LOW' : overdueBy > interval.intervalMiles * 0.5 ? 'MEDIUM' : 'LOW',
      closeProbability: determination.payer === 'PPM' ? 0.85 : hasRecord ? 0.5 : 0.3,
      talkTrack: determination.payer === 'PPM'
        ? `Already paid for on their prepaid plan. Redeem it today.`
        : hasRecord
          ? `Present with the mileage. Bundling it with today's visit saves them a trip.`
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
