import { describe, it, expect } from 'vitest'
import { validateVin, computeCheckDigit, modelYearFromVin, normalizeVin } from './validate'
import { mapVpicRow, deriveIsHybridOrEv, decodeVin } from './decode'
import { componentGroupsForRecall, lookupCandidateRecalls } from './recalls'

describe('VIN validation', () => {
  it('accepts a VIN with a correct check digit', () => {
    // Checksum for this 2013 F-150 pattern is 9. NHTSA's own sample VIN
    // (…ET5DFC10312) carries a 5 here and fails — vPIC decodes it anyway and
    // only mentions the problem in an error field, which is exactly why we
    // validate ourselves.
    const result = validateVin('1FTFW1ET9DFC10312')
    expect(result.wellFormed).toBe(true)
    expect(result.checkDigitValid).toBe(true)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('normalizes case, whitespace and dashes', () => {
    expect(normalizeVin(' 1ftfw1et9dfc10312 ')).toBe('1FTFW1ET9DFC10312')
    expect(validateVin('1ftfw1et9dfc10312').valid).toBe(true)
  })

  it('rejects the letters I, O and Q with a useful message', () => {
    const result = validateVin('1FTFW1ET5DFC1O312')
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/mistyped 1 or 0/i)
  })

  it('rejects a VIN of the wrong length', () => {
    const result = validateVin('1FTFW1ET5DFC103')
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/must be 17 characters/i)
  })

  it('warns rather than errors on a check-digit mismatch', () => {
    // Wrong digit in position 9 — the classic podium typo.
    const result = validateVin('1FTFW1ET5DFC10312')
    expect(result.wellFormed).toBe(true)
    expect(result.checkDigitValid).toBe(false)
    expect(result.valid).toBe(false)
    // Warning, not error: some imports legitimately fail the checksum.
    expect(result.errors).toEqual([])
    expect(result.warnings.join(' ')).toMatch(/door jamb/i)
  })

  it('computes a check digit of X where the remainder is 10', () => {
    const digit = computeCheckDigit('1M8GDM9AXKP042788')
    expect(digit).toBe('X')
  })

  it('returns undefined for an unusable VIN', () => {
    expect(computeCheckDigit('SHORT')).toBeUndefined()
  })
})

describe('model year from VIN position 10', () => {
  it('resolves the current 30-year cycle', () => {
    expect(modelYearFromVin('1FTFW1ET5DFC10312', 2026)).toBe(2013)
  })

  it('allows one model year ahead of the calendar year', () => {
    // "T" maps to 1996 or 2026; in 2026 the newer cycle wins.
    const vin = `1FTFW1ET5T${'0'.repeat(7)}`
    expect(modelYearFromVin(vin, 2026)).toBe(2026)
  })

  it('returns undefined for an invalid year code', () => {
    expect(modelYearFromVin('1FTFW1ET5UFC10312'.replace('U', 'I'), 2026)).toBeUndefined()
  })
})

describe('electrification detection', () => {
  it('detects a battery electric vehicle', () => {
    expect(deriveIsHybridOrEv({ ElectrificationLevel: 'BEV (Battery Electric Vehicle)' })).toBe(true)
  })

  it('detects a plug-in hybrid', () => {
    expect(deriveIsHybridOrEv({ ElectrificationLevel: 'PHEV (Plug-in Hybrid Electric Vehicle)' })).toBe(true)
  })

  it('falls back to the fuel type when electrification level is blank', () => {
    expect(deriveIsHybridOrEv({ ElectrificationLevel: '', FuelTypePrimary: 'Electric' })).toBe(true)
  })

  it('detects a hybrid via the secondary fuel type', () => {
    expect(deriveIsHybridOrEv({ FuelTypePrimary: 'Gasoline', FuelTypeSecondary: 'Electric' })).toBe(true)
  })

  it('reports a conventional gasoline vehicle as not electrified', () => {
    expect(deriveIsHybridOrEv({ FuelTypePrimary: 'Gasoline', ElectrificationLevel: '' })).toBe(false)
  })
})

describe('mapping the vPIC response', () => {
  const row = {
    Make: 'Tesla',
    Model: 'Model 3',
    ModelYear: '2019',
    BodyClass: 'Sedan/Saloon',
    FuelTypePrimary: 'Electric',
    ElectrificationLevel: 'BEV (Battery Electric Vehicle)',
    PlantCountry: 'UNITED STATES (USA)',
    ErrorText: '0 - VIN decoded clean. Check Digit (9th position) is correct',
  }

  it('maps the fields the coverage engine needs', () => {
    const vehicle = mapVpicRow(row, '5YJ3E1EA7KF317806')
    expect(vehicle?.make).toBe('TESLA')
    expect(vehicle?.modelYear).toBe(2019)
    expect(vehicle?.isHybridOrEv).toBe(true)
  })

  it('returns undefined without a make or model year', () => {
    expect(mapVpicRow({ Make: '', ModelYear: '' }, 'X')).toBeUndefined()
    expect(mapVpicRow({ Make: 'Ford' }, 'X')).toBeUndefined()
  })
})

describe('decodeVin', () => {
  const okResponse = (row: Record<string, string>) =>
    ({ ok: true, status: 200, json: async () => ({ Results: [row] }) }) as unknown as Response

  it('decodes a VIN and reports the hybrid flag', async () => {
    const result = await decodeVin('5YJ3E1EA7KF317806', async () =>
      okResponse({ Make: 'Tesla', Model: 'Model 3', ModelYear: '2019', ElectrificationLevel: 'BEV' }),
    )
    expect(result.vehicle?.make).toBe('TESLA')
    expect(result.vehicle?.isHybridOrEv).toBe(true)
  })

  it('does not call the network for a malformed VIN', async () => {
    let called = false
    const result = await decodeVin('NOPE', async () => {
      called = true
      return okResponse({})
    })
    expect(called).toBe(false)
    expect(result.vehicle).toBeUndefined()
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('degrades to manual entry when NHTSA is unreachable', async () => {
    const result = await decodeVin('1FTFW1ET5DFC10312', async () => {
      throw new Error('ECONNREFUSED')
    })
    expect(result.vehicle).toBeUndefined()
    expect(result.errors.join(' ')).toMatch(/manually/i)
  })

  it('degrades to manual entry on an HTTP error', async () => {
    const result = await decodeVin(
      '1FTFW1ET5DFC10312',
      async () => ({ ok: false, status: 503 }) as unknown as Response,
    )
    expect(result.errors.join(' ')).toMatch(/503/)
  })

  it('still surfaces the check-digit warning alongside a successful decode', async () => {
    const result = await decodeVin('1FTFW1ET6DFC10312', async () =>
      okResponse({ Make: 'Ford', Model: 'F-150', ModelYear: '2013' }),
    )
    expect(result.vehicle?.make).toBe('FORD')
    expect(result.warnings.join(' ')).toMatch(/door jamb/i)
  })
})

describe('recall lookup', () => {
  it('maps an NHTSA component string onto the taxonomy', () => {
    const keys = componentGroupsForRecall('POWER TRAIN:AUTOMATIC TRANSMISSION')
    expect(keys).toContain('TRANSMISSION_INTERNAL')
  })

  it('maps an airbag campaign onto the SRS group', () => {
    const keys = componentGroupsForRecall('AIR BAGS:FRONTAL:DRIVER SIDE INFLATOR MODULE')
    expect(keys).toContain('AIRBAG_SRS')
  })

  it('does NOT map a brake fluid campaign onto brake pads', () => {
    // Real campaign 16V345000. Matching the bare word "brakes" here turned a
    // $600 customer-pay brake job into a phantom free recall.
    const keys = componentGroupsForRecall('SERVICE BRAKES, HYDRAULIC:FLUID')
    expect(keys).not.toContain('BRAKE_PADS_SHOES')
  })

  it('does not map a campaign onto a generic system word', () => {
    expect(componentGroupsForRecall('ENGINE')).not.toContain('ENGINE_INTERNAL')
  })

  it('still maps a specific catalytic converter campaign', () => {
    const keys = componentGroupsForRecall('EXHAUST SYSTEM:CATALYTIC CONVERTER')
    expect(keys).toContain('CATALYTIC_CONVERTER')
  })

  it('marks every result as a candidate, never a confirmed open recall', async () => {
    const result = await lookupCandidateRecalls(
      'ford',
      'f-150',
      2013,
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              {
                NHTSACampaignNumber: '19V075000',
                Component: 'POWER TRAIN:AUTOMATIC TRANSMISSION',
                Summary: 'Transmission may downshift unexpectedly',
                parkIt: false,
                parkOutSide: false,
              },
            ],
          }),
        }) as unknown as Response,
    )
    expect(result.recalls).toHaveLength(1)
    expect(result.recalls[0]?.isCandidate).toBe(true)
    expect(result.caveat).toMatch(/not by VIN/i)
    expect(result.caveat).toMatch(/OEM portal/i)
  })

  it('sorts do-not-drive advisories to the top', async () => {
    const result = await lookupCandidateRecalls(
      'ford',
      'f-150',
      2013,
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              { NHTSACampaignNumber: 'A', Component: 'BRAKES', parkIt: false, parkOutSide: false },
              { NHTSACampaignNumber: 'B', Component: 'ENGINE', parkIt: true, parkOutSide: false },
            ],
          }),
        }) as unknown as Response,
    )
    expect(result.recalls[0]?.campaignNumber).toBe('B')
    expect(result.recalls[0]?.parkIt).toBe(true)
  })

  it('requires make, model and year', async () => {
    const result = await lookupCandidateRecalls('', '', 0)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.recalls).toEqual([])
  })
})
