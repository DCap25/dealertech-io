import { addMonths, differenceInCalendarMonths } from 'date-fns'
import { findWarrantyProgram } from './programs'
import {
  CARB_HYBRID_EV_BATTERY,
  FEDERAL_EMISSIONS,
  FEDERAL_HYBRID_EV,
  isCarbState,
  type OemWarrantyProgram,
  type Term,
} from './types'

export interface VehicleWarrantyInput {
  make: string
  modelYear: number
  /** Warranty starts at in-service date, NOT build date or purchase date. */
  inServiceDate: Date
  currentMileage: number
  /** Defaults to now. Injected so tests are deterministic. */
  asOf?: Date
  /**
   * Whether the customer is the original retail purchaser. Drives the
   * Hyundai/Kia/Genesis/Mitsubishi and Stellantis-lifetime distinctions.
   */
  isOriginalOwner: boolean
  isHybridOrEv?: boolean
  /** Two-letter state code — determines whether CARB hybrid terms apply. */
  state?: string
}

export interface TermStatus {
  name: string
  term: Term
  active: boolean
  monthsRemaining: number | null
  milesRemaining: number | null
  expiresOn: Date | null
  expiresAtMiles: number | null
  /** Which axis will run out first, or is closest to doing so. */
  limitingFactor: 'TIME' | 'MILEAGE' | 'UNLIMITED'
  /** Populated only when the term has already lapsed. */
  expiredBy: 'TIME' | 'MILEAGE' | null
}

export interface WarrantySnapshot {
  make: string
  modelYear: number
  /** False when the make is absent from our reference data. */
  known: boolean
  program: OemWarrantyProgram | undefined
  basic: TermStatus | null
  powertrain: TermStatus | null
  corrosion: TermStatus | null
  /** Federal 8yr/80k — catalytic converter, ECM/PCM, onboard diagnostic device. */
  emissionsLong: TermStatus
  /** Federal 2yr/24k — all other emissions-related components. */
  emissionsShort: TermStatus
  hybridEv: TermStatus | null
  /** Advisor-facing notes: first-owner downgrades, unknown makes, CARB uplifts. */
  warnings: string[]
}

const UNLIMITED: Term = { months: null, miles: null }

function isUnlimited(term: Term): boolean {
  return term.months === null && term.miles === null
}

export function computeTermStatus(
  name: string,
  term: Term,
  inServiceDate: Date,
  currentMileage: number,
  asOf: Date,
): TermStatus {
  const expiresOn = term.months === null ? null : addMonths(inServiceDate, term.months)
  const expiresAtMiles = term.miles

  const monthsElapsed = differenceInCalendarMonths(asOf, inServiceDate)
  const monthsRemaining = term.months === null ? null : term.months - monthsElapsed
  const milesRemaining = term.miles === null ? null : term.miles - currentMileage

  const timeExpired = monthsRemaining !== null && monthsRemaining < 0
  const milesExpired = milesRemaining !== null && milesRemaining < 0

  // When both axes lapsed, report whichever lapsed first in proportional terms.
  let expiredBy: 'TIME' | 'MILEAGE' | null = null
  if (timeExpired && milesExpired) {
    const timeOverage = term.months === null ? 0 : monthsElapsed / term.months
    const milesOverage = term.miles === null ? 0 : currentMileage / term.miles
    expiredBy = timeOverage >= milesOverage ? 'TIME' : 'MILEAGE'
  } else if (timeExpired) {
    expiredBy = 'TIME'
  } else if (milesExpired) {
    expiredBy = 'MILEAGE'
  }

  let limitingFactor: TermStatus['limitingFactor']
  if (isUnlimited(term)) {
    limitingFactor = 'UNLIMITED'
  } else if (term.months === null) {
    limitingFactor = 'MILEAGE'
  } else if (term.miles === null) {
    limitingFactor = 'TIME'
  } else {
    // Whichever axis is proportionally more consumed will bind first.
    const timeUsed = monthsElapsed / term.months
    const milesUsed = currentMileage / term.miles
    limitingFactor = milesUsed >= timeUsed ? 'MILEAGE' : 'TIME'
  }

  return {
    name,
    term,
    active: expiredBy === null,
    monthsRemaining,
    milesRemaining,
    expiresOn,
    expiresAtMiles,
    limitingFactor,
    expiredBy,
  }
}

/**
 * Full factory-warranty picture for one vehicle at one moment.
 *
 * Federal emissions terms are always computed, even for an unknown make — they
 * are statutory, so they hold regardless of what we know about the brand. That
 * alone rescues a surprising number of out-of-warranty converter jobs.
 */
export function computeWarrantySnapshot(input: VehicleWarrantyInput): WarrantySnapshot {
  const asOf = input.asOf ?? new Date()
  const { make, modelYear, inServiceDate, currentMileage } = input
  const warnings: string[] = []

  const program = findWarrantyProgram(make, modelYear)
  const status = (name: string, term: Term) =>
    computeTermStatus(name, term, inServiceDate, currentMileage, asOf)

  if (!program) {
    warnings.push(
      `No factory warranty reference data for ${make} ${modelYear}. Federal emissions terms still apply. Verify basic and powertrain coverage in the OEM portal before quoting.`,
    )
  }

  // ---- Powertrain, with the first-owner distinction applied ----
  let powertrainTerm: Term | null = program?.powertrain ?? null
  if (program?.powertrainFirstOwnerOnly) {
    if (input.isOriginalOwner) {
      warnings.push(
        `${program.make} powertrain coverage shown is the ORIGINAL-OWNER term. Confirm this customer is the original retail purchaser before relying on it.`,
      )
    } else {
      powertrainTerm = program.powertrainSubsequentOwner
      warnings.push(
        `Customer is NOT the original owner — ${program.make} powertrain drops from the headline term to the subsequent-owner term. Do not quote the advertised figure.`,
      )
    }
  }

  // ---- Hybrid / EV, with the CARB uplift ----
  let hybridEv: TermStatus | null = null
  if (input.isHybridOrEv) {
    let hybridTerm = program?.hybridEvComponents ?? FEDERAL_HYBRID_EV
    if (input.state && isCarbState(input.state)) {
      const carbIsLonger =
        (CARB_HYBRID_EV_BATTERY.months ?? 0) > (hybridTerm.months ?? 0) ||
        (CARB_HYBRID_EV_BATTERY.miles ?? 0) > (hybridTerm.miles ?? 0)
      if (carbIsLonger) {
        hybridTerm = CARB_HYBRID_EV_BATTERY
        warnings.push(
          `${input.state.toUpperCase()} is a CARB state — the high-voltage battery carries the extended 10yr/150k term, not the federal 8yr/100k floor.`,
        )
      }
    }
    hybridEv = status('Hybrid / EV Components', hybridTerm)
  }

  if (program?.notes) warnings.push(program.notes)

  return {
    make: make.trim().toUpperCase(),
    modelYear,
    known: program !== undefined,
    program,
    basic: program ? status('Basic (Bumper-to-Bumper)', program.basic) : null,
    powertrain: powertrainTerm ? status('Powertrain', powertrainTerm) : null,
    corrosion: program ? status('Corrosion / Perforation', program.corrosionPerforation) : null,
    emissionsLong: status('Federal Emissions (Long)', FEDERAL_EMISSIONS.longTerm),
    emissionsShort: status('Federal Emissions (Short)', FEDERAL_EMISSIONS.shortTerm),
    hybridEv,
    warnings,
  }
}

export { UNLIMITED }
