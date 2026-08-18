import { describe, expect, it } from 'vitest'
import { shouldClaimOwnership } from './index'

/**
 * The owning relationship — DRIVE_PLAN D6.
 *
 * One rule, and the tests are mostly about the ways it must NOT fire. A column
 * that silently reassigns is worse than no column: D4 step 2 routes on it, so a
 * bad write does not just misreport a relationship, it sends six months of a
 * customer's visits to the wrong advisor.
 */

const AT = new Date('2026-08-18T09:15:00')

describe('shouldClaimOwnership', () => {
  it('claims empty ground', () => {
    expect(shouldClaimOwnership({
      currentOwnerId: null,
      advisorId: 'marcus',
      source: 'SALES_INTRO',
      at: AT,
    })).toEqual({ advisorId: 'marcus', source: 'SALES_INTRO', since: AT })
  })

  it('never takes a customer off the advisor who already has them', () => {
    expect(shouldClaimOwnership({
      currentOwnerId: 'dana',
      advisorId: 'marcus',
      source: 'FIRST_VISIT',
      at: AT,
    })).toBeNull()
  })

  it('does not re-stamp "since" when the same advisor serves them again', () => {
    /*
      The subtle one. Writing the same id back looks harmless and destroys the
      only fact the column carries beyond the id — "your customer since March"
      would become "since Tuesday" after every visit.
    */
    expect(shouldClaimOwnership({
      currentOwnerId: 'marcus',
      advisorId: 'marcus',
      source: 'FIRST_VISIT',
      at: AT,
    })).toBeNull()
  })

  it('forms no relationship when the introduction named nobody', () => {
    // Deliberate, and documented: the relationship forms at the first visit
    // instead, with whoever actually greets them.
    expect(shouldClaimOwnership({
      currentOwnerId: null,
      advisorId: null,
      source: 'SALES_INTRO',
      at: AT,
    })).toBeNull()
  })

  it('forms no relationship out of a visit nobody was assigned to', () => {
    expect(shouldClaimOwnership({
      currentOwnerId: undefined,
      advisorId: undefined,
      source: 'FIRST_VISIT',
      at: AT,
    })).toBeNull()
  })

  it('carries the source through, because that is half the record', () => {
    expect(shouldClaimOwnership({
      currentOwnerId: null, advisorId: 'ray', source: 'MANAGER_SET', at: AT,
    })?.source).toBe('MANAGER_SET')
  })
})
