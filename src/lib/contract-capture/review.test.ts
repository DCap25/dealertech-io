import { describe, expect, it } from 'vitest'
import { emptyExtraction, reviewExtraction } from './review'
import { EXTRACTED_FIELDS } from './types'
import type { ExtractedContract, ExtractionContext } from './types'

const CONTEXT: ExtractionContext = {
  vehicleVin: '1FTFW1E84MFA12345',
  vehicleLabel: '2021 FORD F-150',
}

function field<T>(value: T | null, confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'HIGH') {
  return { value, confidence, sourceText: value === null ? null : String(value) }
}

function extraction(over: Partial<ExtractedContract> = {}): ExtractedContract {
  return {
    productType: field('TIRE_WHEEL'),
    adminCompany: field('Safeguard'),
    contractNumber: field('SG-88214'),
    coverageTier: field('Platinum'),
    tierType: field('EXCLUSIONARY'),
    purchaseDate: field('2023-04-11'),
    purchaseMileage: field(12_400),
    expirationDate: field('2028-04-11'),
    expirationMiles: field(87_400),
    termMonths: field(60),
    termMiles: field(75_000),
    deductibleAmount: field(0),
    deductibleType: field('NONE'),
    requiresPriorAuthorization: field(true),
    vin: field('1FTFW1E84MFA12345'),
    ...over,
  }
}

describe('the VIN check', () => {
  it('passes a matching VIN', () => {
    const draft = reviewExtraction(extraction(), CONTEXT)
    expect(draft.issues.filter((i) => i.field === 'vin')).toEqual([])
    expect(draft.saveable).toBe(true)
  })

  it('blocks a contract belonging to a different car', () => {
    // The only blocking rule in the system. A policy on the wrong vehicle is
    // silent — nothing looks wrong on any screen — until someone is told a
    // repair is covered and it is not.
    const draft = reviewExtraction(
      extraction({ vin: field('2HGES16575H900001') }),
      CONTEXT,
    )
    expect(draft.saveable).toBe(false)
    expect(draft.issues.find((i) => i.field === 'vin')?.severity).toBe('BLOCKING')
    expect(draft.issues.find((i) => i.field === 'vin')?.message).toMatch(/different car/i)
  })

  it('says so when a VIN is one character out', () => {
    // A single wrong character is a transcription problem rather than the
    // wrong document, and the advisor's next move is different.
    const draft = reviewExtraction(
      extraction({ vin: field('1FTFW1E84MFA12346') }),
      CONTEXT,
    )
    expect(draft.saveable).toBe(false)
    expect(draft.issues.find((i) => i.field === 'vin')?.message).toMatch(/one character apart/i)
  })

  it('ignores case and spacing on an otherwise matching VIN', () => {
    const draft = reviewExtraction(
      extraction({ vin: field(' 1ftfw1e84mfa12345 ') }),
      CONTEXT,
    )
    expect(draft.saveable).toBe(true)
  })

  it('warns rather than blocks when the document has no VIN', () => {
    // Plenty of real contracts do not print one. Blocking would push the
    // advisor into hand-entering everything, which is worse.
    const draft = reviewExtraction(extraction({ vin: field(null) }), CONTEXT)
    expect(draft.saveable).toBe(true)
    expect(draft.issues.find((i) => i.field === 'vin')?.severity).toBe('WARNING')
  })
})

describe('essentials', () => {
  it('blocks without a product type', () => {
    // It is what the coverage engine arbitrates on. Without it there is
    // nothing to save that the engine could use.
    const draft = reviewExtraction(extraction({ productType: field(null) }), CONTEXT)
    expect(draft.saveable).toBe(false)
  })

  it('warns without an administrator', () => {
    const draft = reviewExtraction(extraction({ adminCompany: field(null) }), CONTEXT)
    expect(draft.saveable).toBe(true)
    expect(draft.issues.find((i) => i.field === 'adminCompany')?.severity).toBe('WARNING')
  })

  it('warns when nothing says the coverage ever ends', () => {
    const draft = reviewExtraction(
      extraction({
        expirationDate: field(null),
        expirationMiles: field(null),
        termMonths: field(null),
        termMiles: field(null),
      }),
      CONTEXT,
    )
    expect(draft.issues.find((i) => i.field === 'document')?.message).toMatch(/every page/i)
  })

  it('does not warn about an ending when only an odometer limit is given', () => {
    // "Expires at 100,000 miles" with no dates and no term is a real contract.
    const draft = reviewExtraction(
      extraction({
        expirationDate: field(null),
        termMonths: field(null),
        termMiles: field(null),
      }),
      CONTEXT,
    )
    expect(draft.issues.find((i) => i.field === 'document')).toBeUndefined()
  })
})

describe('dates', () => {
  it('rejects a non-ISO date rather than guessing which half is the month', () => {
    // "04/11/2028" is two different dates depending on who printed it.
    const draft = reviewExtraction(
      extraction({ expirationDate: field('04/11/2028') }),
      CONTEXT,
    )
    expect(draft.issues.find((i) => i.field === 'expirationDate')?.message).toMatch(/by hand/i)
  })

  it('catches an expiry before the purchase', () => {
    const draft = reviewExtraction(
      extraction({ purchaseDate: field('2028-04-11'), expirationDate: field('2023-04-11') }),
      CONTEXT,
    )
    expect(draft.issues.find((i) => i.field === 'expirationDate')?.message).toMatch(/misread/i)
  })

  it('accepts a well-formed pair', () => {
    expect(reviewExtraction(extraction(), CONTEXT).issues).toEqual([])
  })
})

describe('terms', () => {
  it('flags a term no contract is written for', () => {
    const draft = reviewExtraction(extraction({ termMonths: field(600) }), CONTEXT)
    expect(draft.issues.find((i) => i.field === 'termMonths')).toBeDefined()
    // Still saveable — the advisor may be looking at something unusual.
    expect(draft.saveable).toBe(true)
  })

  it('flags an implausible mileage and deductible', () => {
    const draft = reviewExtraction(
      extraction({ termMiles: field(9_000_000), deductibleAmount: field(-50) }),
      CONTEXT,
    )
    expect(draft.issues.map((i) => i.field)).toEqual(
      expect.arrayContaining(['termMiles', 'deductibleAmount']),
    )
  })

  it('accepts a zero deductible, which is common and correct', () => {
    const draft = reviewExtraction(extraction({ deductibleAmount: field(0) }), CONTEXT)
    expect(draft.issues.find((i) => i.field === 'deductibleAmount')).toBeUndefined()
  })
})

describe('fieldsNeedingReview', () => {
  it('lists anything the model was not sure about', () => {
    const draft = reviewExtraction(
      extraction({
        adminCompany: field('Safeguard', 'MEDIUM'),
        termMiles: field(75_000, 'LOW'),
      }),
      CONTEXT,
    )
    expect(draft.fieldsNeedingReview).toEqual(
      expect.arrayContaining(['adminCompany', 'termMiles']),
    )
    expect(draft.fieldsNeedingReview).not.toContain('productType')
  })

  it('flags every field on a blank draft', () => {
    // Hand entry after a failed extraction, or with no provider at all.
    // Nothing is confirmed, so everything is up for review.
    const draft = reviewExtraction(emptyExtraction(), CONTEXT)
    expect(draft.fieldsNeedingReview).toEqual(EXTRACTED_FIELDS)
    expect(draft.saveable).toBe(false)
  })
})

describe('the tier check', () => {
  it('warns when a service contract does not say which way its list reads', () => {
    // Exclusionary lists what is NOT covered; inclusionary lists what IS. The
    // engine defaults to exclusionary — the generous reading — so an
    // inclusionary contract mistaken for one means promising coverage on a
    // component that was never named.
    const draft = reviewExtraction(
      extraction({ productType: field('VSC'), tierType: field(null) }),
      CONTEXT,
    )
    const issue = draft.issues.find((i) => i.field === 'tierType')
    expect(issue?.severity).toBe('WARNING')
    expect(issue?.message).toMatch(/more generous reading/i)
  })

  it('stays quiet on a product with no component list to read either way', () => {
    // A key replacement policy has no schedule of covered components, so the
    // question does not arise and the warning would be noise.
    const draft = reviewExtraction(
      extraction({ productType: field('KEY'), tierType: field(null) }),
      CONTEXT,
    )
    expect(draft.issues.find((i) => i.field === 'tierType')).toBeUndefined()
  })

  it('stays quiet once the tier type is known', () => {
    const draft = reviewExtraction(
      extraction({ productType: field('VSC'), tierType: field('INCLUSIONARY') }),
      CONTEXT,
    )
    expect(draft.issues.find((i) => i.field === 'tierType')).toBeUndefined()
  })
})

describe('mileages', () => {
  it('catches coverage that would end at or below the mileage at sale', () => {
    // A transposed digit. The contract expired before it started, which is
    // never what the document says.
    const draft = reviewExtraction(
      extraction({ purchaseMileage: field(48_000), expirationMiles: field(24_000) }),
      CONTEXT,
    )
    expect(draft.issues.find((i) => i.field === 'expirationMiles')?.message).toMatch(/misread/i)
    // Still saveable — a warning, because the advisor may be right.
    expect(draft.saveable).toBe(true)
  })

  it('flags an odometer with an extra digit in it', () => {
    const draft = reviewExtraction(extraction({ purchaseMileage: field(1_240_000) }), CONTEXT)
    expect(draft.issues.find((i) => i.field === 'purchaseMileage')?.message).toMatch(/extra digit/i)
  })

  it('accepts a sensible pair', () => {
    const draft = reviewExtraction(
      extraction({ purchaseMileage: field(12_400), expirationMiles: field(112_400) }),
      CONTEXT,
    )
    expect(draft.issues.filter((i) => i.field === 'expirationMiles')).toEqual([])
  })
})
