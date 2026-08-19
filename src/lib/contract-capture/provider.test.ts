import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolveProviderName } from './provider'

describe('which provider runs', () => {
  it('uses the model when there is a key', () => {
    expect(resolveProviderName({ ANTHROPIC_API_KEY: 'sk-ant-test' })).toBe('anthropic')
  })

  it('has no provider without a key', () => {
    expect(resolveProviderName({})).toBe('none')
    expect(resolveProviderName({ ANTHROPIC_API_KEY: '' })).toBe('none')
  })

  it('can be switched off with a key present', () => {
    // For a store that wants hand entry with the document still filed.
    expect(resolveProviderName({ ANTHROPIC_API_KEY: 'sk-ant-test', CONTRACT_EXTRACTION: 'off' }))
      .toBe('none')
    expect(resolveProviderName({ ANTHROPIC_API_KEY: 'sk-ant-test', CONTRACT_EXTRACTION: 'OFF ' }))
      .toBe('none')
  })

  it('ignores an unrecognised setting rather than failing closed on a typo', () => {
    expect(resolveProviderName({ ANTHROPIC_API_KEY: 'sk-ant-test', CONTRACT_EXTRACTION: 'on' }))
      .toBe('anthropic')
  })
})

describe('there is no mock, and there must not be one', () => {
  /*
    This is the one test in the file that is really about the product rather
    than the code.

    Every other provider seam here ships a mock so the app works keyless. This
    one deliberately does not, and the previous version of this file showed why
    it matters: it returned a fully-populated Tire & Wheel contract — an
    administrator, an expiry, a deductible — for whatever vehicle it was handed.
    Confirmed, that reaches the contracts table and the coverage engine cannot
    tell it from a policy somebody read off paper. The product would be
    inventing coverage, which is the single thing it must never do.

    A future contributor tidying up the "missing" mock would be doing something
    reasonable-looking and wrong, so the absence is asserted rather than left
    to a comment nobody reads.
  */
  const source = readFileSync('src/lib/contract-capture/provider.ts', 'utf8')

  it('exports no mock provider', () => {
    expect(source).not.toMatch(/export const mock\w*Provider/)
  })

  it('names no administrator or product value in the fallback path', () => {
    // A mock that returns plausible terms would have to spell them somewhere.
    for (const invented of ['TIRE_WHEEL', 'Safeguard', 'Endurance', 'PER_VISIT']) {
      expect(source).not.toContain(`'${invented}'`)
    }
  })

  it('says in the file itself why it differs from the Co-Pilot seam', () => {
    // A deliberate inconsistency that is not explained gets "fixed".
    expect(source).toMatch(/no mock here/i)
    expect(source).toMatch(/copilot/i)
  })
})
