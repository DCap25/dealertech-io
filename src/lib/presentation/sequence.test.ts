import { describe, expect, it } from 'vitest'
import { sequenceAfter } from './sequence'

/**
 * The query around this needs a database and is not exercised here. What is
 * exercised is the rule it exists to apply, which is the half that was wrong:
 * the tablet path never applied it at all and every tablet menu on a visit
 * called itself the first conversation.
 */
describe('sequenceAfter', () => {
  it('calls the first conversation on a visit 1, not 0', () => {
    // `max()` over no rows is null, and a visit whose first menu is being sent
    // has to be numbered the way the schema comment says: 1 at write-up.
    expect(sequenceAfter(null)).toBe(1)
    expect(sequenceAfter(undefined)).toBe(1)
  })

  it('counts on from what the visit already has', () => {
    expect(sequenceAfter(1)).toBe(2)
    expect(sequenceAfter(2)).toBe(3)
  })

  it('never repeats a number it was given', () => {
    // A busy day produces three — write-up, after the inspection, at delivery —
    // and the whole point of the column is telling them apart.
    for (const highest of [1, 2, 3, 9]) {
      expect(sequenceAfter(highest)).toBeGreaterThan(highest)
    }
  })
})
