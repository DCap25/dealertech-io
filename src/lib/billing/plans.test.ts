import { describe, expect, it } from 'vitest'
import {
  BANDS, bandFor, monthlyTotalCents, previewChange, stripeTiers, unitPriceCents,
} from './plans'

/**
 * The price list.
 *
 * These tests exist mostly to pin the arithmetic that produces an invoice, and
 * to prove the numbers we quote and the tier table we send Stripe are the same
 * numbers. A pricing bug is not a rendering bug — it is a dealership being
 * charged something nobody agreed to.
 */

describe('bands', () => {
  it('prices each band at the agreed rate', () => {
    expect(unitPriceCents(1)).toBe(119_500)
    expect(unitPriceCents(2)).toBe(119_500)
    expect(unitPriceCents(3)).toBe(99_500)
    expect(unitPriceCents(10)).toBe(99_500)
    expect(unitPriceCents(11)).toBe(89_500)
    expect(unitPriceCents(25)).toBe(89_500)
    expect(unitPriceCents(26)).toBe(79_500)
    expect(unitPriceCents(400)).toBe(79_500)
  })

  it('switches band exactly on the boundary, not one either side', () => {
    for (const band of BANDS) {
      expect(bandFor(band.minRooftops)).toBe(band)
      if (band.maxRooftops !== null) {
        expect(bandFor(band.maxRooftops)).toBe(band)
        expect(bandFor(band.maxRooftops + 1)).not.toBe(band)
      }
    }
  })

  it('leaves no gap between bands', () => {
    // A rooftop count that falls between two bands would price at the fallback
    // and nobody would notice until an invoice was wrong.
    for (let n = 1; n <= 60; n++) {
      const band = bandFor(n)
      expect(n).toBeGreaterThanOrEqual(band.minRooftops)
      if (band.maxRooftops !== null) expect(n).toBeLessThanOrEqual(band.maxRooftops)
    }
  })

  it('gets cheaper per rooftop as a group grows, never more expensive', () => {
    let previous = Infinity
    for (const band of BANDS) {
      expect(band.unitAmountCents).toBeLessThan(previous)
      previous = band.unitAmountCents
    }
  })

  it('survives a quantity no real subscription has', () => {
    // Reachable when a group's last rooftop is deactivated with the
    // subscription still open. A page rendering a number must not throw.
    expect(() => bandFor(0)).not.toThrow()
    expect(bandFor(0)).toBe(BANDS[0])
    expect(monthlyTotalCents(0)).toBe(0)
    expect(monthlyTotalCents(-5)).toBe(0)
  })
})

describe('volume, not graduated', () => {
  it('prices every rooftop at the band the whole group falls into', () => {
    // Eleven rooftops is 11 × $895, not 2 × $1,195 + 8 × $995 + 1 × $895.
    expect(monthlyTotalCents(11)).toBe(11 * 89_500)

    const graduated = 2 * 119_500 + 8 * 99_500 + 1 * 89_500
    expect(monthlyTotalCents(11)).not.toBe(graduated)
  })

  it('can make an invoice fall when a rooftop is added', () => {
    /*
      The counter-intuitive case, pinned deliberately. Going from ten rooftops
      to eleven moves the whole group down a band, so the bill rises by far
      less than a rooftop — and going from 25 to 26 actually drops it. The
      console has to explain this or it reads as a bug.
    */
    const crossing = previewChange(25, 26)
    expect(crossing.differenceCents).toBeLessThan(0)
    expect(crossing.bandChange).toEqual({ from: '11–25 rooftops', to: '26+ rooftops' })
  })

  it('reports no band change when a group grows inside its band', () => {
    const within = previewChange(3, 4)
    expect(within.bandChange).toBeNull()
    expect(within.differenceCents).toBe(99_500)
  })
})

describe('the tier table sent to Stripe', () => {
  it('matches the bands we quote from, exactly', () => {
    // The drift test. If somebody edits a band and not the tiers — impossible
    // today, because the tiers are derived — this is what catches it.
    const tiers = stripeTiers()
    expect(tiers).toHaveLength(BANDS.length)
    tiers.forEach((tier, i) => {
      const band = BANDS[i]!
      expect(tier.unit_amount).toBe(band.unitAmountCents)
      expect(tier.up_to).toBe(band.maxRooftops === null ? 'inf' : band.maxRooftops)
    })
  })

  it('ends unbounded, so a large group is never unpriceable', () => {
    const tiers = stripeTiers()
    expect(tiers[tiers.length - 1]!.up_to).toBe('inf')
  })

  it('rises monotonically, which Stripe requires of up_to', () => {
    const bounds = stripeTiers().map((t) => (t.up_to === 'inf' ? Infinity : t.up_to))
    for (let i = 1; i < bounds.length; i++) {
      expect(bounds[i]!).toBeGreaterThan(bounds[i - 1]!)
    }
  })

  it('agrees with our own arithmetic at every boundary', () => {
    /*
      Computes each tier the way Stripe would — quantity × the unit amount of
      the tier the quantity lands in — and checks it against monthlyTotalCents.
      This is the assertion that would catch a volume/graduated mix-up.
    */
    for (const n of [1, 2, 3, 10, 11, 25, 26, 100]) {
      const tier = stripeTiers().find((t) => t.up_to === 'inf' || n <= t.up_to)!
      expect(monthlyTotalCents(n)).toBe(n * tier.unit_amount)
    }
  })
})
