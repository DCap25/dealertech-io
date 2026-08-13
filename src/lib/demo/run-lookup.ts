import { decodeVin, lookupCandidateRecalls, type CandidateRecall } from '@/lib/vin'
import { computeWarrantySnapshot, type WarrantySnapshot } from '@/lib/warranty'
import { evaluateCoverage, type Contract, type CoverageDetermination, type PrepaidEntitlement } from '@/lib/coverage'
import type { DecodedVehicle } from '@/lib/vin'

/**
 * End-to-end lookup: VIN in, "who pays and what else to sell" out.
 *
 * This is the whole product in one function. The demo page is a thin shell
 * around it, and the eventual prep sheet calls the same path per appointment.
 */

export interface LookupRequest {
  vin: string
  concern: string
  currentMileage: number
  inServiceDate: Date
  isOriginalOwner: boolean
  state: string
  laborRate: number
  laborAmount: number
  partsAmount: number
  contracts?: Contract[]
  prepaidEntitlements?: PrepaidEntitlement[]
  visitCount?: number
  lifetimeSpend?: number
  asOf?: Date
}

export interface LookupResult {
  vehicle?: DecodedVehicle
  warranty?: WarrantySnapshot
  determination?: CoverageDetermination
  candidateRecalls: CandidateRecall[]
  recallCaveat?: string
  errors: string[]
  warnings: string[]
}

export async function runLookup(
  request: LookupRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<LookupResult> {
  const errors: string[] = []
  const warnings: string[] = []

  const decoded = await decodeVin(request.vin, fetchImpl)
  errors.push(...decoded.errors)
  warnings.push(...decoded.warnings)

  if (!decoded.vehicle) {
    return { candidateRecalls: [], errors, warnings }
  }
  const vehicle = decoded.vehicle

  // Candidate recalls are advisory — a failure here must not block the
  // coverage answer, which is the part the advisor actually needs.
  let candidateRecalls: CandidateRecall[] = []
  let recallCaveat: string | undefined
  if (vehicle.model) {
    const recalls = await lookupCandidateRecalls(
      vehicle.make,
      vehicle.model,
      vehicle.modelYear,
      fetchImpl,
    )
    candidateRecalls = recalls.recalls
    recallCaveat = recalls.caveat
    warnings.push(...recalls.errors)
  }

  const warranty = computeWarrantySnapshot({
    make: vehicle.make,
    modelYear: vehicle.modelYear,
    inServiceDate: request.inServiceDate,
    currentMileage: request.currentMileage,
    asOf: request.asOf,
    isOriginalOwner: request.isOriginalOwner,
    isHybridOrEv: vehicle.isHybridOrEv,
    state: request.state,
  })

  const determination = evaluateCoverage({
    vehicle: {
      vin: vehicle.vin,
      make: vehicle.make,
      model: vehicle.model,
      modelYear: vehicle.modelYear,
      inServiceDate: request.inServiceDate,
      currentMileage: request.currentMileage,
      isHybridOrEv: vehicle.isHybridOrEv,
      isOriginalOwner: request.isOriginalOwner,
    },
    operation: {
      description: request.concern,
      laborAmount: request.laborAmount,
      partsAmount: request.partsAmount,
    },
    contracts: request.contracts,
    prepaidEntitlements: request.prepaidEntitlements,
    openRecalls: candidateRecalls,
    store: { laborRate: request.laborRate, state: request.state },
    history: {
      visitCount: request.visitCount ?? 0,
      lifetimeSpend: request.lifetimeSpend ?? 0,
    },
    asOf: request.asOf,
  })

  return { vehicle, warranty, determination, candidateRecalls, recallCaveat, errors, warnings }
}
