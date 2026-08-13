import { describe, it, expect } from 'vitest'
import { computeWarrantySnapshot, computeTermStatus } from './compute'
import { findWarrantyProgram, OEM_WARRANTY_PROGRAMS, knownMakes } from './programs'
import { FEDERAL_EMISSIONS } from './types'

const NOW = new Date('2026-08-11T00:00:00Z')

/** A 2019 vehicle placed in service mid-2019 — out of most basic warranties by now. */
const IN_SERVICE_2019 = new Date('2019-06-15T00:00:00Z')

describe('warranty program lookup', () => {
  it('finds a current program by make and model year', () => {
    const p = findWarrantyProgram('toyota', 2022)
    expect(p?.make).toBe('TOYOTA')
    expect(p?.basic).toEqual({ months: 36, miles: 36_000 })
    expect(p?.powertrain).toEqual({ months: 60, miles: 60_000 })
  })

  it('is case and whitespace insensitive', () => {
    expect(findWarrantyProgram('  Ford  ', 2020)?.make).toBe('FORD')
  })

  it('selects the correct program when a brand changed terms mid-history', () => {
    // VW ran a 6yr/72k program for 2018-2019 only.
    expect(findWarrantyProgram('VOLKSWAGEN', 2016)?.basic).toEqual({ months: 36, miles: 36_000 })
    expect(findWarrantyProgram('VOLKSWAGEN', 2018)?.basic).toEqual({ months: 72, miles: 72_000 })
    expect(findWarrantyProgram('VOLKSWAGEN', 2022)?.basic).toEqual({ months: 48, miles: 50_000 })
  })

  it('returns undefined for an unknown make rather than guessing', () => {
    expect(findWarrantyProgram('DELOREAN', 2020)).toBeUndefined()
  })

  it('has no overlapping model-year ranges for a single make', () => {
    const byMake = new Map<string, typeof OEM_WARRANTY_PROGRAMS[number][]>()
    for (const p of OEM_WARRANTY_PROGRAMS) {
      byMake.set(p.make, [...(byMake.get(p.make) ?? []), p])
    }
    for (const [make, programs] of byMake) {
      for (let year = 2007; year <= 2027; year++) {
        const matches = programs.filter(
          (p) =>
            year >= p.effectiveFromModelYear &&
            (p.effectiveToModelYear === null || year <= p.effectiveToModelYear),
        )
        expect(matches.length, `${make} ${year} matched ${matches.length} programs`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('exposes the makes we actually hold data for', () => {
    expect(knownMakes()).toContain('HYUNDAI')
    expect(knownMakes()).toContain('MERCEDES-BENZ')
  })
})

describe('term status arithmetic', () => {
  it('reports remaining time and mileage on an active term', () => {
    const s = computeTermStatus(
      'Basic', { months: 36, miles: 36_000 },
      new Date('2025-08-11T00:00:00Z'), 12_000, NOW,
    )
    expect(s.active).toBe(true)
    expect(s.monthsRemaining).toBe(24)
    expect(s.milesRemaining).toBe(24_000)
    expect(s.expiredBy).toBeNull()
  })

  it('identifies mileage as the binding axis for a high-mileage driver', () => {
    // One year in, already 30k miles: mileage will bind long before time.
    const s = computeTermStatus(
      'Basic', { months: 36, miles: 36_000 },
      new Date('2025-08-11T00:00:00Z'), 30_000, NOW,
    )
    expect(s.active).toBe(true)
    expect(s.limitingFactor).toBe('MILEAGE')
  })

  it('identifies time as the binding axis for a low-mileage driver', () => {
    const s = computeTermStatus(
      'Basic', { months: 36, miles: 36_000 },
      new Date('2023-10-11T00:00:00Z'), 12_000, NOW,
    )
    expect(s.limitingFactor).toBe('TIME')
  })

  it('marks a term expired by mileage', () => {
    const s = computeTermStatus(
      'Basic', { months: 36, miles: 36_000 },
      new Date('2025-02-11T00:00:00Z'), 44_000, NOW,
    )
    expect(s.active).toBe(false)
    expect(s.expiredBy).toBe('MILEAGE')
  })

  it('treats an unlimited term as permanently active', () => {
    const s = computeTermStatus(
      'Lifetime Powertrain', { months: null, miles: null },
      new Date('2008-01-01T00:00:00Z'), 250_000, NOW,
    )
    expect(s.active).toBe(true)
    expect(s.limitingFactor).toBe('UNLIMITED')
    expect(s.monthsRemaining).toBeNull()
    expect(s.milesRemaining).toBeNull()
  })

  it('handles unlimited mileage with a finite time limit', () => {
    const s = computeTermStatus(
      'Corrosion', { months: 60, miles: null },
      new Date('2023-08-11T00:00:00Z'), 180_000, NOW,
    )
    expect(s.active).toBe(true)
    expect(s.limitingFactor).toBe('TIME')
    expect(s.milesRemaining).toBeNull()
  })
})

describe('the Hyundai / Kia first-owner trap', () => {
  const base = {
    make: 'HYUNDAI',
    modelYear: 2019,
    inServiceDate: IN_SERVICE_2019,
    currentMileage: 78_000,
    asOf: NOW,
    isHybridOrEv: false,
  }

  it('gives the original owner the full 10yr/100k powertrain', () => {
    const snap = computeWarrantySnapshot({ ...base, isOriginalOwner: true })
    expect(snap.powertrain?.term).toEqual({ months: 120, miles: 100_000 })
    expect(snap.powertrain?.active).toBe(true)
    expect(snap.warnings.join(' ')).toContain('ORIGINAL-OWNER term')
  })

  it('drops a second owner to 5yr/60k — and that term has already lapsed', () => {
    const snap = computeWarrantySnapshot({ ...base, isOriginalOwner: false })
    expect(snap.powertrain?.term).toEqual({ months: 60, miles: 60_000 })
    expect(snap.powertrain?.active).toBe(false)
    expect(snap.warnings.join(' ')).toContain('NOT the original owner')
  })

  it('produces opposite answers for the same car depending only on ownership', () => {
    // The entire point: same VIN, same mileage, same day — different payer.
    const first = computeWarrantySnapshot({ ...base, isOriginalOwner: true })
    const second = computeWarrantySnapshot({ ...base, isOriginalOwner: false })
    expect(first.powertrain?.active).toBe(true)
    expect(second.powertrain?.active).toBe(false)
  })
})

describe('federal emissions warranty', () => {
  it('applies the 8yr/80k term even when the make is unknown to us', () => {
    const snap = computeWarrantySnapshot({
      make: 'SOMEBRAND', modelYear: 2020,
      inServiceDate: new Date('2020-01-15T00:00:00Z'),
      currentMileage: 70_000, asOf: NOW, isOriginalOwner: true,
    })
    expect(snap.known).toBe(false)
    expect(snap.basic).toBeNull()
    // Statutory coverage does not depend on our reference data.
    expect(snap.emissionsLong.active).toBe(true)
    expect(snap.emissionsLong.term).toEqual(FEDERAL_EMISSIONS.longTerm)
    expect(snap.warnings.join(' ')).toContain('Federal emissions terms still apply')
  })

  it('keeps the converter covered on a car long out of basic and powertrain warranty', () => {
    // 2019 Ford at 70k: basic gone, powertrain gone, converter still free.
    const snap = computeWarrantySnapshot({
      make: 'FORD', modelYear: 2019, inServiceDate: IN_SERVICE_2019,
      currentMileage: 70_000, asOf: NOW, isOriginalOwner: true,
    })
    expect(snap.basic?.active).toBe(false)
    expect(snap.powertrain?.active).toBe(false)
    expect(snap.emissionsLong.active).toBe(true)
  })

  it('expires the short emissions term long before the long one', () => {
    const snap = computeWarrantySnapshot({
      make: 'TOYOTA', modelYear: 2021, inServiceDate: new Date('2021-03-01T00:00:00Z'),
      currentMileage: 40_000, asOf: NOW, isOriginalOwner: true,
    })
    expect(snap.emissionsShort.active).toBe(false)
    expect(snap.emissionsLong.active).toBe(true)
  })
})

describe('hybrid and EV coverage', () => {
  it('falls back to the federal floor when the brand has no published term', () => {
    const snap = computeWarrantySnapshot({
      make: 'SOMEBRAND', modelYear: 2021, inServiceDate: new Date('2021-01-01T00:00:00Z'),
      currentMileage: 60_000, asOf: NOW, isOriginalOwner: true, isHybridOrEv: true,
    })
    expect(snap.hybridEv?.term).toEqual({ months: 96, miles: 100_000 })
  })

  it('applies the CARB 10yr/150k battery term in a CARB state', () => {
    const snap = computeWarrantySnapshot({
      make: 'TOYOTA', modelYear: 2019, inServiceDate: IN_SERVICE_2019,
      currentMileage: 120_000, asOf: NOW, isOriginalOwner: true,
      isHybridOrEv: true, state: 'CA',
    })
    expect(snap.hybridEv?.term).toEqual({ months: 120, miles: 150_000 })
    expect(snap.hybridEv?.active).toBe(true)
    expect(snap.warnings.join(' ')).toContain('CARB state')
  })

  it('leaves the same car uncovered at that mileage in a non-CARB state', () => {
    const snap = computeWarrantySnapshot({
      make: 'TOYOTA', modelYear: 2019, inServiceDate: IN_SERVICE_2019,
      currentMileage: 120_000, asOf: NOW, isOriginalOwner: true,
      isHybridOrEv: true, state: 'TX',
    })
    expect(snap.hybridEv?.term).toEqual({ months: 96, miles: 100_000 })
    expect(snap.hybridEv?.active).toBe(false)
  })

  it('omits hybrid coverage entirely for a conventional vehicle', () => {
    const snap = computeWarrantySnapshot({
      make: 'TOYOTA', modelYear: 2022, inServiceDate: new Date('2022-01-01T00:00:00Z'),
      currentMileage: 20_000, asOf: NOW, isOriginalOwner: true,
    })
    expect(snap.hybridEv).toBeNull()
  })
})

describe('the Stellantis lifetime powertrain program', () => {
  it('keeps a 2008 original owner covered at 250,000 miles', () => {
    const snap = computeWarrantySnapshot({
      make: 'JEEP', modelYear: 2008, inServiceDate: new Date('2008-04-01T00:00:00Z'),
      currentMileage: 250_000, asOf: NOW, isOriginalOwner: true,
    })
    expect(snap.powertrain?.active).toBe(true)
    expect(snap.warnings.join(' ')).toContain('LIFETIME powertrain')
  })

  it('holds a second owner to 5yr/100k, long since lapsed', () => {
    const snap = computeWarrantySnapshot({
      make: 'JEEP', modelYear: 2008, inServiceDate: new Date('2008-04-01T00:00:00Z'),
      currentMileage: 250_000, asOf: NOW, isOriginalOwner: false,
    })
    expect(snap.powertrain?.active).toBe(false)
  })

  it('does not apply the lifetime program to a 2012 model year', () => {
    const snap = computeWarrantySnapshot({
      make: 'JEEP', modelYear: 2012, inServiceDate: new Date('2012-04-01T00:00:00Z'),
      currentMileage: 150_000, asOf: NOW, isOriginalOwner: true,
    })
    expect(snap.powertrain?.term).toEqual({ months: 60, miles: 60_000 })
    expect(snap.powertrain?.active).toBe(false)
  })
})

describe('brands without a separate powertrain term', () => {
  it('mirrors basic into powertrain for BMW', () => {
    const snap = computeWarrantySnapshot({
      make: 'BMW', modelYear: 2023, inServiceDate: new Date('2023-01-01T00:00:00Z'),
      currentMileage: 30_000, asOf: NOW, isOriginalOwner: true,
    })
    expect(snap.powertrain?.term).toEqual(snap.basic?.term)
  })

  it('gives BMW a 12-year corrosion term still active at 10 years', () => {
    const snap = computeWarrantySnapshot({
      make: 'BMW', modelYear: 2016, inServiceDate: new Date('2016-01-01T00:00:00Z'),
      currentMileage: 140_000, asOf: NOW, isOriginalOwner: true,
    })
    expect(snap.corrosion?.active).toBe(true)
  })
})
