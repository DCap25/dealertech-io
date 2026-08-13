import type { OemWarrantyProgram, Term } from './types'

const T = (months: number | null, miles: number | null): Term => ({ months, miles })

/** Unlimited mileage — used for corrosion perforation terms on most brands. */
const UNLIMITED_MILES = null

function program(
  make: string,
  effectiveFromModelYear: number,
  basic: Term,
  powertrain: Term,
  opts: Partial<Omit<OemWarrantyProgram, 'make' | 'effectiveFromModelYear' | 'basic' | 'powertrain'>> = {},
): OemWarrantyProgram {
  return {
    make,
    effectiveFromModelYear,
    effectiveToModelYear: null,
    basic,
    powertrain,
    powertrainFirstOwnerOnly: false,
    powertrainSubsequentOwner: null,
    corrosionPerforation: T(60, UNLIMITED_MILES),
    hybridEvComponents: null,
    roadside: null,
    ...opts,
  }
}

/**
 * Seed warranty programs for the major US franchise brands.
 *
 * Ordered so that `findWarrantyProgram` can take the first match on make +
 * model-year range. Historical entries appear before current ones.
 */
export const OEM_WARRANTY_PROGRAMS: readonly OemWarrantyProgram[] = [
  // ------------------------------------------------ Hyundai Motor Group
  // The first-owner distinction is the single most valuable correctness rule
  // in this table.
  program('HYUNDAI', 2010, T(60, 60_000), T(120, 100_000), {
    powertrainFirstOwnerOnly: true,
    powertrainSubsequentOwner: T(60, 60_000),
    corrosionPerforation: T(84, UNLIMITED_MILES),
    hybridEvComponents: T(120, 100_000),
    roadside: T(60, UNLIMITED_MILES),
    notes:
      '10yr/100k powertrain is ORIGINAL OWNER ONLY. A second owner receives 5yr/60k. Verify ownership before quoting.',
  }),
  program('KIA', 2010, T(60, 60_000), T(120, 100_000), {
    powertrainFirstOwnerOnly: true,
    powertrainSubsequentOwner: T(60, 60_000),
    corrosionPerforation: T(60, 100_000),
    hybridEvComponents: T(120, 100_000),
    roadside: T(60, 60_000),
    notes: '10yr/100k powertrain is ORIGINAL OWNER ONLY. A second owner receives 5yr/60k.',
  }),
  program('GENESIS', 2017, T(60, 60_000), T(120, 100_000), {
    powertrainFirstOwnerOnly: true,
    powertrainSubsequentOwner: T(60, 60_000),
    corrosionPerforation: T(84, UNLIMITED_MILES),
    hybridEvComponents: T(120, 100_000),
    roadside: T(36, 36_000),
    notes: '10yr/100k powertrain is ORIGINAL OWNER ONLY.',
  }),
  program('MITSUBISHI', 2015, T(60, 60_000), T(120, 100_000), {
    powertrainFirstOwnerOnly: true,
    powertrainSubsequentOwner: T(60, 60_000),
    corrosionPerforation: T(84, 100_000),
    hybridEvComponents: T(120, 100_000),
    notes: '10yr/100k powertrain is ORIGINAL OWNER ONLY.',
  }),

  // ------------------------------------------------------------- Toyota
  program('TOYOTA', 2010, T(36, 36_000), T(60, 60_000), {
    corrosionPerforation: T(60, UNLIMITED_MILES),
    hybridEvComponents: T(96, 100_000),
    roadside: T(24, UNLIMITED_MILES),
    notes:
      'Hybrid battery extended to 10yr/150k for 2020 and newer. Other hybrid components remain 8yr/100k.',
  }),
  program('LEXUS', 2010, T(48, 50_000), T(72, 70_000), {
    corrosionPerforation: T(72, UNLIMITED_MILES),
    hybridEvComponents: T(96, 100_000),
    roadside: T(48, UNLIMITED_MILES),
    notes: 'Hybrid battery extended to 10yr/150k for 2020 and newer.',
  }),

  // -------------------------------------------------------------- Honda
  program('HONDA', 2010, T(36, 36_000), T(60, 60_000), {
    corrosionPerforation: T(60, UNLIMITED_MILES),
    hybridEvComponents: T(96, 100_000),
  }),
  program('ACURA', 2010, T(48, 50_000), T(72, 70_000), {
    corrosionPerforation: T(60, UNLIMITED_MILES),
    hybridEvComponents: T(96, 100_000),
    roadside: T(48, 50_000),
  }),

  // ---------------------------------------------------------------- Ford
  program('FORD', 2010, T(36, 36_000), T(60, 60_000), {
    corrosionPerforation: T(60, UNLIMITED_MILES),
    hybridEvComponents: T(96, 100_000),
    notes: 'Diesel powertrain terms differ substantially — verify separately for Super Duty.',
  }),
  program('LINCOLN', 2010, T(48, 50_000), T(72, 70_000), {
    corrosionPerforation: T(60, UNLIMITED_MILES),
    hybridEvComponents: T(96, 100_000),
    roadside: T(48, 50_000),
  }),

  // --------------------------------------------------- General Motors
  // GM ran 5yr/100k powertrain through 2015 and cut it to 5yr/60k for 2016.
  // A 2015 truck at 90k is still covered; treating it as unknown loses a
  // legitimate warranty claim.
  program('CHEVROLET', 2007, T(36, 36_000), T(60, 100_000), {
    effectiveToModelYear: 2015,
    corrosionPerforation: T(72, 100_000),
    roadside: T(60, 100_000),
  }),
  program('GMC', 2007, T(36, 36_000), T(60, 100_000), {
    effectiveToModelYear: 2015,
    corrosionPerforation: T(72, 100_000),
    roadside: T(60, 100_000),
  }),
  program('BUICK', 2007, T(48, 50_000), T(72, 100_000), {
    effectiveToModelYear: 2015,
    corrosionPerforation: T(72, 100_000),
    roadside: T(72, 100_000),
  }),
  program('CADILLAC', 2007, T(48, 50_000), T(72, 100_000), {
    effectiveToModelYear: 2015,
    corrosionPerforation: T(72, 100_000),
    roadside: T(72, 100_000),
  }),
  program('CHEVROLET', 2016, T(36, 36_000), T(60, 60_000), {
    corrosionPerforation: T(72, 100_000),
    hybridEvComponents: T(96, 100_000),
    roadside: T(60, 60_000),
  }),
  program('GMC', 2016, T(36, 36_000), T(60, 60_000), {
    corrosionPerforation: T(72, 100_000),
    hybridEvComponents: T(96, 100_000),
    roadside: T(60, 60_000),
  }),
  program('BUICK', 2016, T(48, 50_000), T(72, 70_000), {
    corrosionPerforation: T(72, 100_000),
    roadside: T(72, 70_000),
  }),
  program('CADILLAC', 2016, T(48, 50_000), T(72, 70_000), {
    corrosionPerforation: T(72, 100_000),
    hybridEvComponents: T(96, 100_000),
    roadside: T(72, 70_000),
  }),

  // ------------------------------------------------------- Stellantis
  // The 2007–2009 lifetime powertrain program is still on the road and still
  // honoured for the original owner. Advisors routinely miss it.
  program('CHRYSLER', 2007, T(36, 36_000), T(null, null), {
    effectiveToModelYear: 2009,
    powertrainFirstOwnerOnly: true,
    powertrainSubsequentOwner: T(60, 100_000),
    corrosionPerforation: T(60, 100_000),
    notes:
      'LIFETIME powertrain for the original owner (2007-2009 program), requiring a documented inspection every 5 years. Second owner receives 5yr/100k. Verify the inspection history before denying.',
  }),
  program('CHRYSLER', 2010, T(36, 36_000), T(60, 60_000), { corrosionPerforation: T(60, 100_000) }),
  program('DODGE', 2007, T(36, 36_000), T(null, null), {
    effectiveToModelYear: 2009,
    powertrainFirstOwnerOnly: true,
    powertrainSubsequentOwner: T(60, 100_000),
    corrosionPerforation: T(60, 100_000),
    notes: 'LIFETIME powertrain for the original owner (2007-2009 program).',
  }),
  program('DODGE', 2010, T(36, 36_000), T(60, 60_000), { corrosionPerforation: T(60, 100_000) }),
  program('JEEP', 2007, T(36, 36_000), T(null, null), {
    effectiveToModelYear: 2009,
    powertrainFirstOwnerOnly: true,
    powertrainSubsequentOwner: T(60, 100_000),
    corrosionPerforation: T(60, 100_000),
    notes: 'LIFETIME powertrain for the original owner (2007-2009 program).',
  }),
  program('JEEP', 2010, T(36, 36_000), T(60, 60_000), { corrosionPerforation: T(60, 100_000) }),
  program('RAM', 2011, T(36, 36_000), T(60, 60_000), {
    corrosionPerforation: T(60, 100_000),
    notes: 'Cummins diesel powertrain runs 5yr/100k — longer than the gasoline term.',
  }),

  // --------------------------------------------------------------- Nissan
  program('NISSAN', 2010, T(36, 36_000), T(60, 60_000), {
    corrosionPerforation: T(60, UNLIMITED_MILES),
    hybridEvComponents: T(96, 100_000),
    notes: 'LEAF and Ariya EV battery capacity coverage runs 8yr/100k against defined capacity loss.',
  }),
  program('INFINITI', 2010, T(48, 60_000), T(72, 70_000), {
    corrosionPerforation: T(84, UNLIMITED_MILES),
    hybridEvComponents: T(96, 100_000),
    roadside: T(48, 60_000),
  }),

  // -------------------------------------------------------- Subaru / Mazda
  program('SUBARU', 2010, T(36, 36_000), T(60, 60_000), {
    corrosionPerforation: T(60, UNLIMITED_MILES),
    hybridEvComponents: T(96, 100_000),
  }),
  program('MAZDA', 2010, T(36, 36_000), T(60, 60_000), {
    corrosionPerforation: T(60, UNLIMITED_MILES),
  }),

  // ------------------------------------------------------ Volkswagen Group
  program('VOLKSWAGEN', 2010, T(36, 36_000), T(60, 60_000), {
    effectiveToModelYear: 2017,
    corrosionPerforation: T(84, 100_000),
  }),
  program('VOLKSWAGEN', 2018, T(72, 72_000), T(72, 72_000), {
    effectiveToModelYear: 2019,
    corrosionPerforation: T(84, 100_000),
    notes:
      '2018-2019 carried a 6yr/72k transferable bumper-to-bumper program. Terms reverted to 4yr/50k for 2020.',
  }),
  program('VOLKSWAGEN', 2020, T(48, 50_000), T(48, 50_000), {
    corrosionPerforation: T(84, 100_000),
    hybridEvComponents: T(96, 100_000),
    notes: 'Bumper-to-bumper subsumes powertrain — there is no separate longer powertrain term.',
  }),
  program('AUDI', 2010, T(48, 50_000), T(48, 50_000), {
    corrosionPerforation: T(144, UNLIMITED_MILES),
    hybridEvComponents: T(96, 100_000),
    notes: 'No separate powertrain term — powertrain is covered by the 4yr/50k bumper-to-bumper.',
  }),
  program('PORSCHE', 2010, T(48, 50_000), T(48, 50_000), {
    corrosionPerforation: T(144, UNLIMITED_MILES),
    hybridEvComponents: T(96, 100_000),
  }),

  // ------------------------------------------------------------- German lux
  program('BMW', 2010, T(48, 50_000), T(48, 50_000), {
    corrosionPerforation: T(144, UNLIMITED_MILES),
    hybridEvComponents: T(96, 100_000),
    roadside: T(48, UNLIMITED_MILES),
    notes: 'No separate powertrain term. Rust perforation runs 12 years, unlimited miles.',
  }),
  program('MINI', 2010, T(48, 50_000), T(48, 50_000), {
    corrosionPerforation: T(144, UNLIMITED_MILES),
    roadside: T(48, UNLIMITED_MILES),
  }),
  program('MERCEDES-BENZ', 2010, T(48, 50_000), T(48, 50_000), {
    corrosionPerforation: T(48, 50_000),
    hybridEvComponents: T(96, 100_000),
    notes: 'No separate powertrain term.',
  }),
  program('VOLVO', 2010, T(48, 50_000), T(48, 50_000), {
    corrosionPerforation: T(144, UNLIMITED_MILES),
    hybridEvComponents: T(96, 100_000),
    notes: 'No separate powertrain term.',
  }),
  program('JAGUAR', 2010, T(60, 60_000), T(60, 60_000), {
    corrosionPerforation: T(72, UNLIMITED_MILES),
  }),
  program('LAND ROVER', 2010, T(48, 50_000), T(48, 50_000), {
    corrosionPerforation: T(72, UNLIMITED_MILES),
  }),

  // -------------------------------------------------------------------- EV
  program('TESLA', 2012, T(48, 50_000), T(96, 100_000), {
    corrosionPerforation: T(144, UNLIMITED_MILES),
    hybridEvComponents: T(96, 100_000),
    notes:
      'Battery and drive unit coverage varies by model: 8yr/100k on Model 3 Standard Range, 8yr/120k on Model 3/Y Long Range, 8yr/150k on Model S/X. Verify by model before quoting.',
  }),
  program('RIVIAN', 2022, T(60, 60_000), T(96, 175_000), {
    corrosionPerforation: T(96, UNLIMITED_MILES),
    hybridEvComponents: T(96, 175_000),
  }),
  program('LUCID', 2022, T(48, 50_000), T(96, 100_000), {
    corrosionPerforation: T(144, UNLIMITED_MILES),
    hybridEvComponents: T(96, 100_000),
  }),
] as const

/**
 * The applicable program for a make and model year, or `undefined` when the
 * brand is unknown to us.
 *
 * Callers MUST treat `undefined` as "we don't know" and degrade confidence —
 * never as "no warranty".
 */
export function findWarrantyProgram(
  make: string,
  modelYear: number,
): OemWarrantyProgram | undefined {
  const normalized = make.trim().toUpperCase()
  return OEM_WARRANTY_PROGRAMS.find(
    (p) =>
      p.make === normalized &&
      modelYear >= p.effectiveFromModelYear &&
      (p.effectiveToModelYear === null || modelYear <= p.effectiveToModelYear),
  )
}

/** Every make we hold data for — used to warn an advisor before they rely on a blank. */
export function knownMakes(): string[] {
  return [...new Set(OEM_WARRANTY_PROGRAMS.map((p) => p.make))].sort()
}
