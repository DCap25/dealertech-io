/**
 * OEM factory warranty reference data.
 *
 * IMPORTANT — read before trusting any value in here.
 *
 * These are seed values reflecting the most widely published terms for each
 * brand in the stated model-year range. Real warranty terms are defined by the
 * warranty booklet delivered with the specific vehicle, and they change by
 * model year, by model, by market, and occasionally mid-year. Certified
 * pre-owned programs extend them further.
 *
 * The arbitration engine therefore treats every result from this table as
 * ADVISORY: an unknown make returns LOW confidence rather than a guess, and a
 * near-expiry determination always instructs the advisor to verify in the OEM
 * portal before committing to a customer. See docs/PLAN.md §7 risk 2.
 */

/** `null` means unlimited on that axis. */
export interface Term {
  months: number | null
  miles: number | null
}

export interface OemWarrantyProgram {
  /** Normalized uppercase make, matching NHTSA vPIC output (e.g. "MERCEDES-BENZ"). */
  make: string
  effectiveFromModelYear: number
  /** `null` means "current, still in effect". */
  effectiveToModelYear: number | null

  /** Bumper-to-bumper. */
  basic: Term
  powertrain: Term

  /**
   * Hyundai, Kia, Genesis and Mitsubishi publish a headline 10yr/100k
   * powertrain figure that applies ONLY to the original retail purchaser. A
   * second owner gets substantially less. Advisors quote the headline number
   * to used-car buyers constantly, and the store eats the difference.
   */
  powertrainFirstOwnerOnly: boolean
  /** Applies when `powertrainFirstOwnerOnly` is true and the customer is not the original owner. */
  powertrainSubsequentOwner: Term | null

  /** Rust-through / perforation. Surface rust is not covered. */
  corrosionPerforation: Term

  /** Hybrid, EV and high-voltage components where the OEM exceeds the federal floor. */
  hybridEvComponents: Term | null

  roadside: Term | null

  notes?: string
}

/**
 * Federal emissions warranty under the Clean Air Act. Statutory, so it applies
 * to every make sold in the US regardless of brand policy.
 */
export const FEDERAL_EMISSIONS = {
  /**
   * Catalytic converter, the engine control module, and the onboard diagnostic
   * device only. This is the term that rescues an out-of-basic-warranty
   * customer from a four-figure converter bill.
   */
  longTerm: { months: 96, miles: 80_000 } satisfies Term,
  /** All other emissions-related components. */
  shortTerm: { months: 24, miles: 24_000 } satisfies Term,
} as const

/**
 * Federal minimum for hybrid/EV high-voltage components. CARB states require
 * 10yr/150k on the battery for vehicles certified to California standards, so a
 * store in a CARB state must not quote the federal floor.
 */
export const FEDERAL_HYBRID_EV = { months: 96, miles: 100_000 } satisfies Term
export const CARB_HYBRID_EV_BATTERY = { months: 120, miles: 150_000 } satisfies Term

/** States that have adopted California emissions standards. */
export const CARB_STATES = [
  'CA', 'CO', 'CT', 'DE', 'MA', 'MD', 'ME', 'MN', 'NJ', 'NM',
  'NV', 'NY', 'OR', 'PA', 'RI', 'VA', 'VT', 'WA',
] as const

export type CarbState = (typeof CARB_STATES)[number]

export function isCarbState(state: string): boolean {
  return (CARB_STATES as readonly string[]).includes(state.toUpperCase())
}
