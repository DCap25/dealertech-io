import { describe, expect, it } from 'vitest'
import {
  STRICT_THRESHOLD, comparePrices, needsReauthorisation, type PricedLine,
} from './reprice'

const line = (id: string, customerPrice: number, title = id): PricedLine =>
  ({ id, title, customerPrice })

/** What the customer saw and agreed to. */
const authorised = () => [line('oil', 84, 'Oil & Filter Change'), line('brakes', 618, 'Front Brakes')]

describe('nothing to ask about', () => {
  it('says so when the prices have not moved', () => {
    const report = comparePrices(authorised(), authorised())
    expect(report.verdict).toBe('UNCHANGED')
    expect(needsReauthorisation(report)).toBe(false)
  })

  it('never makes an advisor chase a re-authorisation to charge less', () => {
    // A system that did would be routed around within a week, and rightly.
    const report = comparePrices(authorised(), [line('oil', 84), line('brakes', 560)])
    expect(report.verdict).toBe('CHEAPER')
    expect(needsReauthorisation(report)).toBe(false)
    expect(report.summary).toMatch(/less than authorised/i)
  })

  it('treats a penny of float drift as rounding, not a price change', () => {
    const report = comparePrices(authorised(), [line('oil', 84.004), line('brakes', 618)])
    expect(report.verdict).toBe('UNCHANGED')
    expect(report.increases).toHaveLength(0)
  })
})

describe('an increase', () => {
  it('stops the work under the strict default', () => {
    // Any real increase needs asking again. Conservative on purpose: nobody is
    // harmed by being asked, and the reverse is a disputed bill.
    const report = comparePrices(authorised(), [line('oil', 95), line('brakes', 618)])
    expect(report.verdict).toBe('NEEDS_REAUTHORISATION')
    expect(report.increase).toBe(11)
  })

  it('names the line that moved, and by how much', () => {
    // "The price went up" is not something an advisor can take to a customer.
    const report = comparePrices(authorised(), [line('oil', 84), line('brakes', 742, 'Front Brakes')])
    expect(report.summary).toContain('Front Brakes')
    expect(report.summary).toContain('$618')
    expect(report.summary).toContain('$742')
  })

  it('puts the biggest movement first', () => {
    const report = comparePrices(
      [line('a', 100), line('b', 100), line('c', 100)],
      [line('a', 110), line('b', 150), line('c', 105)],
    )
    expect(report.increases.map((i) => i.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('a store tolerance', () => {
  const tolerant = { percent: 10, amount: 50 }

  it('lets a small increase through when the store allows one', () => {
    const report = comparePrices(authorised(), [line('oil', 94), line('brakes', 618)], tolerant)
    expect(report.verdict).toBe('WITHIN_TOLERANCE')
    expect(report.summary).toMatch(/mention/i)
  })

  it('requires BOTH limits to be cleared', () => {
    // Percentage alone waves through a large increase on a large ticket;
    // amount alone waves through a small ticket doubling. Either on its own
    // is a loophole.
    const authorisedLines = [line('big', 5_000)]

    // 2% — inside the percentage, outside the £50.
    const byAmount = comparePrices(authorisedLines, [line('big', 5_100)], tolerant)
    expect(byAmount.verdict).toBe('NEEDS_REAUTHORISATION')

    // $40 on a $100 ticket — inside the amount, outside the 10%.
    const byPercent = comparePrices([line('small', 100)], [line('small', 140)], tolerant)
    expect(byPercent.verdict).toBe('NEEDS_REAUTHORISATION')
  })

  it('is strict by default', () => {
    const report = comparePrices(authorised(), [line('oil', 85), line('brakes', 618)])
    expect(STRICT_THRESHOLD).toEqual({ percent: 0, amount: 0 })
    expect(report.verdict).toBe('NEEDS_REAUTHORISATION')
  })
})

describe('lines that came or went', () => {
  it('does not treat a line that vanished as drift', () => {
    // It cannot be billed, so there is nothing to re-authorise — and dropping
    // it only ever helps the customer.
    const report = comparePrices(authorised(), [line('oil', 84)])
    expect(report.disappeared.map((d) => d.id)).toEqual(['brakes'])
    expect(report.verdict).toBe('CHEAPER')
    expect(needsReauthorisation(report)).toBe(false)
  })

  it('ignores a line the customer never authorised', () => {
    // Work that appeared afterwards was never agreed to at any price. That is
    // a new recommendation and a new conversation, not a repricing.
    const report = comparePrices(authorised(), [...authorised(), line('tyres', 1_100)])
    expect(report.verdict).toBe('UNCHANGED')
    expect(report.currentTotal).toBe(702)
  })

  it('handles an empty authorisation without inventing drift', () => {
    const report = comparePrices([], [line('oil', 84)])
    expect(report.verdict).toBe('UNCHANGED')
    expect(report.authorisedTotal).toBe(0)
  })
})

describe('the totals', () => {
  it('compares like with like when a line disappears', () => {
    // The current total must not silently include work the customer never
    // saw, or the comparison stops meaning anything.
    const report = comparePrices(
      [line('oil', 84), line('brakes', 618)],
      [line('oil', 84), line('tyres', 1_100)],
    )
    expect(report.authorisedTotal).toBe(702)
    expect(report.currentTotal).toBe(84)
  })
})
