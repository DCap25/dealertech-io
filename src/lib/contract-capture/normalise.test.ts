import { describe, expect, it } from 'vitest'
import {
  normaliseBoolean, normaliseConfidence, normaliseEnum, normaliseExtraction,
  normaliseInteger, normaliseIsoDate, normaliseMoney, normaliseSourceText, normaliseText,
} from './normalise'
import { PRODUCT_TYPES } from './vocabulary'

/**
 * The rule every test here is checking: an unreadable value becomes null,
 * never a guess. A null reaches the advisor as "not found" and gets typed. A
 * guess reaches them as a filled field and gets confirmed by someone
 * skim-reading — and then a customer is told their transmission is covered.
 */

describe('confidence', () => {
  it('takes the model at its word when the word is one it knows', () => {
    expect(normaliseConfidence('HIGH')).toBe('HIGH')
    expect(normaliseConfidence('medium')).toBe('MEDIUM')
    expect(normaliseConfidence(' low ')).toBe('LOW')
  })

  it('rounds an unreadable confidence down, not up', () => {
    // If the model's own account of how sure it was is unparseable, reading
    // that as certainty is exactly the wrong direction.
    expect(normaliseConfidence('very sure')).toBe('LOW')
    expect(normaliseConfidence(undefined)).toBe('LOW')
    expect(normaliseConfidence(3)).toBe('LOW')
  })
})

describe('text', () => {
  it('collapses the whitespace a line break puts in the middle of a name', () => {
    expect(normaliseText('Safeguard Products\n  International')).toBe(
      'Safeguard Products International',
    )
  })

  it('treats prose for "nothing here" as nothing', () => {
    // Models asked for null sometimes answer in words instead.
    for (const value of ['N/A', 'n/a', 'none', 'Unknown', 'not found', 'not specified', '--']) {
      expect(normaliseText(value)).toBeNull()
    }
  })

  it('keeps a contract number that only looks like nothing', () => {
    expect(normaliseText('NA-4471')).toBe('NA-4471')
    expect(normaliseText(88214)).toBe('88214')
  })

  it('drops empty and non-string input', () => {
    expect(normaliseText('   ')).toBeNull()
    expect(normaliseText(null)).toBeNull()
    expect(normaliseText({})).toBeNull()
  })
})

describe('source text', () => {
  it('keeps the characters as read, trimmed', () => {
    expect(normaliseSourceText('  Contract No. SG-88214 ')).toBe('Contract No. SG-88214')
  })

  it('treats empty as absent', () => {
    expect(normaliseSourceText('')).toBeNull()
    expect(normaliseSourceText(42)).toBeNull()
  })
})

describe('ISO dates', () => {
  it('accepts a well-formed date', () => {
    expect(normaliseIsoDate('2023-04-11')).toBe('2023-04-11')
  })

  it('refuses a format that means two different dates', () => {
    // "04/11/2028" is April 11th or November 4th depending on who printed it,
    // and on a service contract that is seven months of coverage.
    expect(normaliseIsoDate('04/11/2028')).toBeNull()
    expect(normaliseIsoDate('11 April 2028')).toBeNull()
  })

  it('refuses a date that is not a date', () => {
    // 2023-02-30 passes the regex. `new Date` would roll it to March 2nd
    // without complaining, which is a silently wrong expiry.
    expect(normaliseIsoDate('2023-02-30')).toBeNull()
    expect(normaliseIsoDate('2023-13-01')).toBeNull()
    expect(normaliseIsoDate('2024-02-29')).toBe('2024-02-29')
  })

  it('refuses a year that is a misread rather than history', () => {
    expect(normaliseIsoDate('1823-04-11')).toBeNull()
    expect(normaliseIsoDate('2223-04-11')).toBeNull()
  })
})

describe('money', () => {
  it('reads a number out of what a document puts around one', () => {
    expect(normaliseMoney('$100')).toBe(100)
    expect(normaliseMoney('$1,200.00 per visit')).toBe(1200)
    expect(normaliseMoney(50)).toBe(50)
  })

  it('keeps zero, which is a real deductible and not an absent one', () => {
    expect(normaliseMoney(0)).toBe(0)
    expect(normaliseMoney('$0')).toBe(0)
  })

  it('drops a negative, which is a misread minus sign', () => {
    expect(normaliseMoney(-50)).toBeNull()
  })

  it('drops what is not a number at all', () => {
    expect(normaliseMoney('see schedule')).toBeNull()
    expect(normaliseMoney(null)).toBeNull()
  })
})

describe('integers', () => {
  it('reads a count out of a phrase', () => {
    expect(normaliseInteger('75,000 miles')).toBe(75_000)
    expect(normaliseInteger('60 months')).toBe(60)
  })

  it('rounds a fractional value rather than keeping spurious precision', () => {
    expect(normaliseInteger('60.4')).toBe(60)
  })

  it('drops a negative odometer', () => {
    expect(normaliseInteger(-5)).toBeNull()
  })

  it('leaves implausible-but-real values alone for review to warn about', () => {
    // 600 months is wrong, but it is review.ts's job to say so to the advisor
    // rather than this module's job to silently discard it.
    expect(normaliseInteger(600)).toBe(600)
  })
})

describe('closed vocabularies', () => {
  it('accepts a member', () => {
    expect(normaliseEnum('TIRE_WHEEL', PRODUCT_TYPES)).toBe('TIRE_WHEEL')
  })

  it('tolerates the spacing and case a model might use', () => {
    expect(normaliseEnum('tire wheel', PRODUCT_TYPES)).toBe('TIRE_WHEEL')
    expect(normaliseEnum(' vsc ', PRODUCT_TYPES)).toBe('VSC')
  })

  it('refuses an invented member', () => {
    // "TIRE_AND_WHEEL" is a plausible thing for a model to write and is not a
    // ProductType. Letting it through puts a value in the database the
    // coverage engine cannot arbitrate on.
    expect(normaliseEnum('TIRE_AND_WHEEL', PRODUCT_TYPES)).toBeNull()
    expect(normaliseEnum('GAP', PRODUCT_TYPES)).toBeNull()
  })
})

describe('booleans', () => {
  it('reads a yes or a no however it is spelled', () => {
    expect(normaliseBoolean(true)).toBe(true)
    expect(normaliseBoolean('Required')).toBe(true)
    expect(normaliseBoolean('yes')).toBe(true)
    expect(normaliseBoolean('No')).toBe(false)
    expect(normaliseBoolean('not required')).toBe(false)
  })

  it('returns null rather than false when it cannot tell', () => {
    // For prior authorisation these are very different answers, and the
    // difference is a denied claim. buildConfirmedValues turns null into
    // "required"; turning it into false here would hide that decision.
    expect(normaliseBoolean('see claims procedure')).toBeNull()
    expect(normaliseBoolean(null)).toBeNull()
  })
})

describe('the whole response', () => {
  const good = {
    productType: { value: 'VSC', confidence: 'HIGH', sourceText: 'VEHICLE SERVICE CONTRACT' },
    adminCompany: { value: 'Endurance', confidence: 'HIGH', sourceText: 'Endurance Dealer Services' },
    termMonths: { value: 60, confidence: 'HIGH', sourceText: '60 months' },
  }

  it('reads the fields that are there', () => {
    const out = normaliseExtraction(good)
    expect(out.productType.value).toBe('VSC')
    expect(out.adminCompany.value).toBe('Endurance')
    expect(out.termMonths).toEqual({ value: 60, confidence: 'HIGH', sourceText: '60 months' })
  })

  it('blanks the fields that are not, rather than leaving them undefined', () => {
    const out = normaliseExtraction(good)
    expect(out.coverageTier).toEqual({ value: null, confidence: 'LOW', sourceText: null })
    expect(out.vin.value).toBeNull()
  })

  it('survives a response that is not the schema at all', () => {
    // A refusal, a truncation at max_tokens, a malformed body. JSON.parse
    // hands back `any` and every field access after that is a lie the
    // compiler agreed to.
    for (const junk of [null, undefined, 'sorry, I cannot help', 42, []]) {
      const out = normaliseExtraction(junk)
      expect(out.productType.value).toBeNull()
      expect(out.deductibleAmount.value).toBeNull()
    }
  })

  it('demotes a field whose value failed to coerce, but keeps where to look', () => {
    // The advisor still needs to know which part of the page the unreadable
    // thing was on — that is what makes typing it quick.
    const out = normaliseExtraction({
      purchaseDate: { value: '04/11/2028', confidence: 'HIGH', sourceText: 'Effective 04/11/2028' },
    })
    expect(out.purchaseDate.value).toBeNull()
    expect(out.purchaseDate.confidence).toBe('LOW')
    expect(out.purchaseDate.sourceText).toBe('Effective 04/11/2028')
  })

  it('refuses to let a HIGH confidence launder an invented product type', () => {
    const out = normaliseExtraction({
      productType: { value: 'GAP_INSURANCE', confidence: 'HIGH', sourceText: 'GAP' },
    })
    expect(out.productType.value).toBeNull()
    expect(out.productType.confidence).toBe('LOW')
  })
})
