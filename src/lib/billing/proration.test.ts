import { describe, expect, it } from 'vitest'
import { describeProration, previewProration, remainingFraction } from './proration'
import { monthlyTotalCents } from './plans'

/**
 * Mid-period quantity changes.
 *
 * These numbers get read aloud to a fixed ops director on a phone call, so the
 * bar is that they are right for the ordinary cases and never optimistic. The
 * band-crossing tests are the ones that matter: volume pricing means adding a
 * rooftop can lower the bill, and a console that got that wrong would be out
 * by thousands and look like a bug.
 */

const PERIOD_START = new Date('2026-06-01T00:00:00.000Z')
const PERIOD_END = new Date('2026-07-01T00:00:00.000Z')
/** Exactly halfway through a 30-day period. */
const MIDPOINT = new Date('2026-06-16T00:00:00.000Z')

function preview(from: number, to: number, asOf = MIDPOINT) {
  return previewProration({
    fromRooftops: from,
    toRooftops: to,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    asOf,
  })
}

describe('how much of the period is left', () => {
  it('is half at the midpoint', () => {
    expect(remainingFraction(PERIOD_START, PERIOD_END, MIDPOINT)).toBeCloseTo(0.5, 5)
  })

  it('is all of it on the first day and none on the last', () => {
    expect(remainingFraction(PERIOD_START, PERIOD_END, PERIOD_START)).toBe(1)
    expect(remainingFraction(PERIOD_START, PERIOD_END, PERIOD_END)).toBe(0)
  })

  it('clamps rather than going outside 0–1', () => {
    /*
      Reachable from a stale page or a mid-renewal race. A fraction above one
      or below zero produces a confidently wrong number instead of an
      obviously wrong one, which is the worse failure.
    */
    expect(remainingFraction(PERIOD_START, PERIOD_END, new Date('2026-05-01'))).toBe(1)
    expect(remainingFraction(PERIOD_START, PERIOD_END, new Date('2026-09-01'))).toBe(0)
  })

  it('is zero for a period with no duration', () => {
    expect(remainingFraction(PERIOD_START, PERIOD_START, PERIOD_START)).toBe(0)
  })
})

describe('adding a rooftop inside a band', () => {
  it('charges half a month for a change at the midpoint', () => {
    // 3 → 4 rooftops, both in the 3–10 band at $995.
    const p = preview(3, 4)
    expect(p.monthlyDifferenceCents).toBe(99_500)
    expect(p.immediateCents).toBe(49_750)
    expect(p.bandChange).toBeNull()
    expect(p.counterIntuitive).toBeNull()
  })

  it('charges the full amount for a change on day one', () => {
    const p = preview(3, 4, PERIOD_START)
    expect(p.immediateCents).toBe(99_500)
  })

  it('charges nothing for a change as the period closes', () => {
    const p = preview(3, 4, PERIOD_END)
    expect(p.immediateCents).toBe(0)
    // The monthly change still stands — it just starts next period.
    expect(p.monthlyDifferenceCents).toBe(99_500)
  })
})

describe('removing a rooftop', () => {
  it('credits rather than charges', () => {
    const p = preview(4, 3)
    expect(p.monthlyDifferenceCents).toBe(-99_500)
    expect(p.immediateCents).toBeLessThan(0)
  })
})

describe('crossing a volume band — the case that surprises people', () => {
  it('lowers the bill when a rooftop is added at 25 → 26', () => {
    /*
      25 × $895 = $22,375. 26 × $795 = $20,670. Adding a store saves them
      $1,705 a month, because volume pricing re-prices every rooftop rather
      than only the new one. A console showing "+1 rooftop, +$795" here would
      be out by two and a half thousand dollars.
    */
    const p = preview(25, 26)
    expect(p.currentMonthlyCents).toBe(25 * 89_500)
    expect(p.newMonthlyCents).toBe(26 * 79_500)
    expect(p.monthlyDifferenceCents).toBeLessThan(0)
    expect(p.bandChange).not.toBeNull()
    expect(p.bandChange!.to.label).toBe('26+ rooftops')
  })

  it('says so in words, because the arithmetic alone reads as a bug', () => {
    const p = preview(25, 26)
    expect(p.counterIntuitive).toContain('falls')
    expect(p.counterIntuitive).toContain('volume pricing')
  })

  it('warns the other way too — removing a rooftop can raise the bill', () => {
    // 26 → 25 moves out of the cheapest band. Worth saying before they hear
    // it from an invoice.
    const p = preview(26, 25)
    expect(p.monthlyDifferenceCents).toBeGreaterThan(0)
    expect(p.counterIntuitive).toContain('rises')
  })

  it('stays silent when the direction matches the intuition', () => {
    expect(preview(3, 4).counterIntuitive).toBeNull()
    expect(preview(4, 3).counterIntuitive).toBeNull()
  })
})

describe('never optimistic', () => {
  it('rounds a charge up', () => {
    /*
      A third of a period through, 1 → 2 rooftops at $1,195 each. The exact
      figure has a fraction of a cent in it; the quoted one must not be below
      what Stripe invoices.
    */
    const thirdIn = new Date('2026-06-11T00:00:00.000Z')
    const p = preview(1, 2, thirdIn)
    const exact = p.monthlyDifferenceCents * p.remainingFraction
    expect(p.immediateCents).toBeGreaterThanOrEqual(exact)
    expect(p.immediateCents - exact).toBeLessThan(1)
  })

  it('rounds a credit toward zero rather than away', () => {
    const thirdIn = new Date('2026-06-11T00:00:00.000Z')
    const p = preview(2, 1, thirdIn)
    const exact = p.monthlyDifferenceCents * p.remainingFraction
    // A smaller credit is the cautious direction.
    expect(p.immediateCents).toBeGreaterThanOrEqual(exact)
  })
})

describe('agreement with the catalog', () => {
  it('uses the same monthly figures the billing page quotes', () => {
    // The console and the dealership's own billing screen must not disagree
    // about what a group of N rooftops costs.
    for (const n of [1, 2, 3, 10, 11, 25, 26, 40]) {
      const p = preview(n, n)
      expect(p.currentMonthlyCents).toBe(monthlyTotalCents(n))
      expect(p.newMonthlyCents).toBe(monthlyTotalCents(n))
      expect(p.monthlyDifferenceCents).toBe(0)
      expect(p.immediateCents).toBe(0)
    }
  })

  it('survives a quantity no real subscription has', () => {
    expect(() => preview(0, 1)).not.toThrow()
    expect(() => preview(-3, 2)).not.toThrow()
  })
})

describe('the sentence somebody reads aloud', () => {
  it('states the monthly change and what happens today', () => {
    const line = describeProration(preview(3, 4))
    expect(line).toContain('goes up by')
    expect(line).toContain('charged now')
  })

  it('says nothing is charged today when the change lands at period end', () => {
    const line = describeProration(preview(3, 4, PERIOD_END))
    expect(line).toContain('nothing charged today')
  })

  it('describes a credit as a credit', () => {
    expect(describeProration(preview(4, 3))).toContain('credited')
  })

  it('reports no change without inventing one', () => {
    expect(describeProration(preview(5, 5))).toContain('does not change')
  })
})
