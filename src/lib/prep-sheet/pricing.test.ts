import { describe, expect, it } from 'vitest'
import { resolvePrice, toPriceBook, type PriceBook } from './pricing'

const book: PriceBook = toPriceBook([
  { code: 'LOF', description: 'Lube, Oil & Filter', laborAmount: 39, partsAmount: 45 },
  { code: 'MPI', description: 'Multi-Point Inspection', laborAmount: 0, partsAmount: 0 },
])

describe('resolvePrice', () => {
  it('quotes the store’s own money when it has a price', () => {
    // The whole point: before this, every dealership quoted the same constants
    // regardless of their labour rate or their market.
    expect(resolvePrice(book, 'LOF', 84)).toEqual({ amount: 84, source: 'STORE', opCode: 'LOF' })
  })

  it('follows the op code when it moves', () => {
    const repriced = toPriceBook([
      { code: 'LOF', description: 'Lube, Oil & Filter', laborAmount: 61, partsAmount: 45 },
    ])
    expect(resolvePrice(repriced, 'LOF', 84).amount).toBe(106)
  })

  it('falls back rather than dropping a recommendation', () => {
    // A store that has not mapped a code still needs a number. A line that
    // vanished because its price was missing is worse than one priced
    // approximately — the customer simply never hears about their brakes.
    expect(resolvePrice(book, 'NOT-MAPPED', 250))
      .toEqual({ amount: 250, source: 'ESTIMATE', opCode: null })
  })

  it('falls back when there is no price book at all', () => {
    // An integration with no price book endpoint. Everything is an estimate,
    // which is what happened everywhere before this existed.
    expect(resolvePrice(undefined, 'LOF', 84).source).toBe('ESTIMATE')
  })

  it('falls back when the recommendation names no op code', () => {
    expect(resolvePrice(book, undefined, 84).source).toBe('ESTIMATE')
  })

  it('refuses to quote a brake job at no charge', () => {
    // A zero is far more often a code that exists with its pricing not filled
    // in than a genuinely free service, and quoting nothing is a worse failure
    // than quoting an estimate.
    expect(resolvePrice(book, 'MPI', 120))
      .toEqual({ amount: 120, source: 'ESTIMATE', opCode: null })
  })

  it('says which it used, so an advisor can tell the difference', () => {
    // "Your op code says $106" and "we think it's about $84" are different
    // degrees of confidence and only one is safe to defend to a customer.
    expect(resolvePrice(book, 'LOF', 84).source).toBe('STORE')
    expect(resolvePrice(book, 'MISSING', 84).source).toBe('ESTIMATE')
  })
})

describe('toPriceBook', () => {
  it('keys by op code', () => {
    expect(Object.keys(book).sort()).toEqual(['LOF', 'MPI'])
  })

  it('drops a row with no code rather than keying on empty string', () => {
    // An empty key would silently match every recommendation that names no
    // op code, pricing unrelated work from whatever row happened to be blank.
    const built = toPriceBook([
      { code: '', description: 'Nameless', laborAmount: 10, partsAmount: 10 },
    ])
    expect(Object.keys(built)).toEqual([])
  })
})
