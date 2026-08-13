import { validateVin, type VinValidation } from './validate'

/**
 * VIN decode via NHTSA vPIC — free, unauthenticated, no rate limit published.
 *
 * We deliberately depend on a public government source rather than a paid data
 * vendor so a store can be onboarded without procurement. The tradeoff is that
 * vPIC has no recall remedy status and no trim-level detail; see recalls.ts.
 */

const VPIC_BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles'

/** The subset of vPIC's ~140 fields we actually use. */
export interface DecodedVehicle {
  vin: string
  make: string
  model: string
  modelYear: number
  trim?: string
  bodyClass?: string
  driveType?: string
  engineCylinders?: number
  displacementL?: number
  fuelTypePrimary?: string
  electrificationLevel?: string
  /**
   * Derived, not reported directly by vPIC. Drives the hybrid/EV warranty
   * branch — including the CARB 10yr/150k battery term, which is the difference
   * between a covered battery and a five-figure customer-pay estimate.
   */
  isHybridOrEv: boolean
  plantCountry?: string
  /** vPIC's own complaint about the VIN, when it has one. */
  decodeErrorText?: string
}

export interface VinDecodeResult {
  validation: VinValidation
  vehicle?: DecodedVehicle
  /** Advisor-facing problems: bad VIN, network failure, unusable response. */
  errors: string[]
  warnings: string[]
}

interface VpicRow {
  [key: string]: string | undefined
}

function str(row: VpicRow, key: string): string | undefined {
  const value = row[key]
  return value && value.trim() !== '' ? value.trim() : undefined
}

function num(row: VpicRow, key: string): number | undefined {
  const value = str(row, key)
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * True when the vehicle has a high-voltage powertrain.
 *
 * vPIC reports this two ways and neither is always populated, so we check both.
 * A false negative here silently strips hybrid warranty coverage, so this errs
 * toward detecting electrification.
 */
export function deriveIsHybridOrEv(row: VpicRow): boolean {
  const level = (str(row, 'ElectrificationLevel') ?? '').toLowerCase()
  const fuel = (str(row, 'FuelTypePrimary') ?? '').toLowerCase()
  const secondaryFuel = (str(row, 'FuelTypeSecondary') ?? '').toLowerCase()

  if (level.includes('bev') || level.includes('phev') || level.includes('hev')) return true
  if (level.includes('electric') || level.includes('hybrid')) return true
  if (fuel.includes('electric') || secondaryFuel.includes('electric')) return true
  return false
}

export function mapVpicRow(row: VpicRow, vin: string): DecodedVehicle | undefined {
  const make = str(row, 'Make')
  const modelYear = num(row, 'ModelYear')
  // Without a make and model year there is nothing the coverage engine can use.
  if (!make || !modelYear) return undefined

  return {
    vin,
    make: make.toUpperCase(),
    model: str(row, 'Model') ?? '',
    modelYear,
    trim: str(row, 'Trim'),
    bodyClass: str(row, 'BodyClass'),
    driveType: str(row, 'DriveType'),
    engineCylinders: num(row, 'EngineCylinders'),
    displacementL: num(row, 'DisplacementL'),
    fuelTypePrimary: str(row, 'FuelTypePrimary'),
    electrificationLevel: str(row, 'ElectrificationLevel'),
    isHybridOrEv: deriveIsHybridOrEv(row),
    plantCountry: str(row, 'PlantCountry'),
    decodeErrorText: str(row, 'ErrorText'),
  }
}

export async function decodeVin(
  vin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VinDecodeResult> {
  const validation = validateVin(vin)
  const errors: string[] = [...validation.errors]
  const warnings: string[] = [...validation.warnings]

  if (!validation.wellFormed) {
    return { validation, errors, warnings }
  }

  const url = `${VPIC_BASE}/DecodeVinValues/${validation.normalized}?format=json`

  let payload: { Results?: VpicRow[] }
  try {
    const response = await fetchImpl(url)
    if (!response.ok) {
      errors.push(`NHTSA VIN decode failed with HTTP ${response.status}. Enter vehicle details manually.`)
      return { validation, errors, warnings }
    }
    payload = (await response.json()) as { Results?: VpicRow[] }
  } catch (cause) {
    errors.push(
      `Could not reach the NHTSA VIN decoder (${cause instanceof Error ? cause.message : 'network error'}). Enter vehicle details manually.`,
    )
    return { validation, errors, warnings }
  }

  const row = payload.Results?.[0]
  if (!row) {
    errors.push('NHTSA returned no results for this VIN.')
    return { validation, errors, warnings }
  }

  const vehicle = mapVpicRow(row, validation.normalized)
  if (!vehicle) {
    errors.push('NHTSA could not identify the make and model year for this VIN.')
    return { validation, errors, warnings }
  }

  if (vehicle.decodeErrorText && !vehicle.decodeErrorText.startsWith('0')) {
    warnings.push(`NHTSA reported: ${vehicle.decodeErrorText}`)
  }

  return { validation, vehicle, errors, warnings }
}
