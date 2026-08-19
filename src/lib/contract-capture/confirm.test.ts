import { describe, expect, it } from 'vitest'
import { buildConfirmedValues, readSubmittedContract } from './confirm'
import { emptyExtraction } from './review'
import type { ExtractedContract } from './types'

/**
 * What actually reaches the contracts table.
 *
 * These are the last checks before a row exists that the coverage engine will
 * answer on for years.
 */

const COMPLETE: Record<string, string> = {
  productType: 'VSC',
  adminCompany: 'Endurance',
  contractNumber: 'END-4471',
  coverageTier: 'Platinum',
  tierType: 'EXCLUSIONARY',
  purchaseDate: '2023-04-11',
  purchaseMileage: '12,400',
  expirationDate: '2028-04-11',
  expirationMiles: '112400',
  termMonths: '60',
  termMiles: '100000',
  deductibleAmount: '$100',
  deductibleType: 'PER_VISIT',
  requiresPriorAuthorization: 'true',
  vin: '1FTFW1E84MFA12345',
}

function reader(over: Record<string, string | null> = {}) {
  const merged: Record<string, string | null> = { ...COMPLETE, ...over }
  return (name: string) => merged[name] ?? null
}

function contractFrom(over: Record<string, string | null> = {}): ExtractedContract {
  return readSubmittedContract(reader(over))
}

describe('reading the submitted form', () => {
  it('runs submitted values through the same normalisers the model output gets', () => {
    // The advisor may have typed "$100" and "12,400". A server action is a
    // public endpoint, so nothing arriving here is trusted to be clean.
    const submitted = contractFrom()
    expect(submitted.deductibleAmount.value).toBe(100)
    expect(submitted.purchaseMileage.value).toBe(12_400)
    expect(submitted.requiresPriorAuthorization.value).toBe(true)
  })

  it('marks everything HIGH with no source text, which is the honest reading', () => {
    // A person looked at each of these and pressed a button; none of them came
    // off the page verbatim any more.
    const submitted = contractFrom()
    expect(submitted.adminCompany.confidence).toBe('HIGH')
    expect(submitted.adminCompany.sourceText).toBeNull()
  })

  it('refuses an invented product type posted straight to the action', () => {
    const submitted = contractFrom({ productType: 'GAP' })
    expect(submitted.productType.value).toBeNull()
  })

  it('treats a missing field as absent rather than empty', () => {
    const submitted = contractFrom({ contractNumber: null })
    expect(submitted.contractNumber.value).toBeNull()
  })
})

describe('required fields', () => {
  it('builds a payload when the three essentials are there', () => {
    const result = buildConfirmedValues(contractFrom())
    expect(result.ok).toBe(true)
  })

  it('refuses without a product type, which is what the engine arbitrates on', () => {
    const result = buildConfirmedValues(contractFrom({ productType: null }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.missing).toEqual(['productType'])
    expect(result.message).toMatch(/product/i)
  })

  it('refuses without an administrator, who is the one who authorises a claim', () => {
    const result = buildConfirmedValues(contractFrom({ adminCompany: null }))
    expect(result.ok).toBe(false)
  })

  it('refuses without a purchase date, which every term calculation starts from', () => {
    const result = buildConfirmedValues(contractFrom({ purchaseDate: null }))
    expect(result.ok).toBe(false)
  })

  it('names all three when a blank form is submitted, not just the first', () => {
    const result = buildConfirmedValues(emptyExtraction())
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.missing).toEqual(['productType', 'adminCompany', 'purchaseDate'])
    expect(result.message).toMatch(/product, administrator and purchase date/i)
  })

  it('does not demand the fields real paperwork often omits', () => {
    // Demanding these would push advisors into inventing values, which is the
    // failure this whole flow exists to prevent.
    const result = buildConfirmedValues(
      contractFrom({
        contractNumber: null,
        coverageTier: null,
        expirationDate: null,
        expirationMiles: null,
        purchaseMileage: null,
        termMiles: null,
        vin: null,
      }),
    )
    expect(result.ok).toBe(true)
  })
})

describe('the defaults, which each fail in the cheaper direction', () => {
  it('treats an unknown prior authorisation as required', () => {
    // A wasted phone call costs five minutes. Tearing down an engine without
    // the call is the most common reason a valid claim is denied outright.
    const result = buildConfirmedValues(contractFrom({ requiresPriorAuthorization: null }))
    if (!result.ok) throw new Error('expected a payload')
    expect(result.values.requiresPriorAuthorization).toBe(true)
  })

  it('does not invent a per-visit deductible on a zero-deductible contract', () => {
    // The column's own default is PER_VISIT, so deferring to it would attach a
    // deductible type to a contract that has no deductible.
    const result = buildConfirmedValues(
      contractFrom({ deductibleAmount: '0', deductibleType: null }),
    )
    if (!result.ok) throw new Error('expected a payload')
    expect(result.values.deductibleAmount).toBe(0)
    expect(result.values.deductibleType).toBe('NONE')
  })

  it('derives per-visit when there is a deductible and no type given', () => {
    const result = buildConfirmedValues(
      contractFrom({ deductibleAmount: '100', deductibleType: null }),
    )
    if (!result.ok) throw new Error('expected a payload')
    expect(result.values.deductibleType).toBe('PER_VISIT')
  })

  it('keeps an explicit per-repair rather than deriving over it', () => {
    const result = buildConfirmedValues(contractFrom({ deductibleType: 'PER_REPAIR' }))
    if (!result.ok) throw new Error('expected a payload')
    expect(result.values.deductibleType).toBe('PER_REPAIR')
  })

  it('defaults a missing deductible amount to zero rather than to null', () => {
    const result = buildConfirmedValues(contractFrom({ deductibleAmount: null }))
    if (!result.ok) throw new Error('expected a payload')
    expect(result.values.deductibleAmount).toBe(0)
  })

  it('defaults the tier type to exclusionary, matching the column', () => {
    const result = buildConfirmedValues(contractFrom({ tierType: null }))
    if (!result.ok) throw new Error('expected a payload')
    expect(result.values.tierType).toBe('EXCLUSIONARY')
  })
})

describe('the payload itself', () => {
  it('carries every field the contracts table stores', () => {
    const result = buildConfirmedValues(contractFrom())
    if (!result.ok) throw new Error('expected a payload')
    expect(result.values).toEqual({
      productType: 'VSC',
      adminCompany: 'Endurance',
      contractNumber: 'END-4471',
      coverageTier: 'Platinum',
      tierType: 'EXCLUSIONARY',
      purchaseDate: '2023-04-11',
      purchaseMileage: 12_400,
      expirationDate: '2028-04-11',
      expirationMiles: 112_400,
      termMonths: 60,
      termMiles: 100_000,
      deductibleAmount: 100,
      deductibleType: 'PER_VISIT',
      requiresPriorAuthorization: true,
    })
  })

  it('does not carry the VIN, which belongs to the vehicle and not the contract', () => {
    const result = buildConfirmedValues(contractFrom())
    if (!result.ok) throw new Error('expected a payload')
    expect(result.values).not.toHaveProperty('vin')
  })
})
