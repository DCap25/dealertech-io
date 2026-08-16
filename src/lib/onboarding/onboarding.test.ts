import { describe, expect, it } from 'vitest'
import {
  ACKNOWLEDGEABLE, STEPS, isAcknowledgeable, progress, type StoreSignals,
} from './steps'

/**
 * The onboarding checklist.
 *
 * The property that matters most: a step goes back to undone when the thing it
 * describes stops being true. A checklist of boxes somebody once ticked is a
 * checklist that lies, and the lie surfaces as a customer being quoted a price
 * the DMS will not honour.
 */

const SIGNED_UP = new Date('2026-06-01T00:00:00.000Z')

function signals(over: Partial<StoreSignals> = {}): StoreSignals {
  return {
    storeCreatedAt: SIGNED_UP,
    laborRate: 0,
    partsTaxRate: 0,
    laborTaxRate: 0,
    staffCount: 1,
    pendingInvites: 0,
    opCodeCount: 0,
    declineCount: 0,
    importCount: 0,
    presentationCount: 0,
    firstPresentationAt: null,
    acknowledged: new Set<string>(),
    ...over,
  }
}

describe('a brand-new rooftop', () => {
  it('has nothing done and is not ready for the drive', () => {
    const p = progress(signals())
    expect(p.doneCount).toBe(0)
    expect(p.readyForTheDrive).toBe(false)
  })

  it('names the essential steps rather than just counting them', () => {
    // A nag that says "3 steps remaining" is one nobody acts on.
    const p = progress(signals())
    expect(p.outstandingEssential.map((s) => s.key).sort())
      .toEqual(['HISTORY_IMPORTED', 'LABOR_RATE', 'PRICE_BOOK'])
  })

  it('says what breaks for every step, not just what to do', () => {
    for (const step of STEPS) {
      expect(step.consequence.length, step.key).toBeGreaterThan(30)
    }
  })
})

describe('steps observed from data', () => {
  it('completes the door rate once it is set', () => {
    const p = progress(signals({ laborRate: 195 }))
    const step = p.steps.find((s) => s.key === 'LABOR_RATE')!
    expect(step.done).toBe(true)
    expect(step.detail).toBe('$195/hr')
  })

  it('goes back to undone when the thing stops being true', () => {
    /*
      The whole argument for deriving rather than storing. A store that
      deletes their op codes must not keep a green tick claiming otherwise —
      the first anyone would know is a customer quoted an estimate the DMS
      will not honour.
    */
    const before = progress(signals({ opCodeCount: 400 }))
    const after = progress(signals({ opCodeCount: 0 }))
    expect(before.steps.find((s) => s.key === 'PRICE_BOOK')!.done).toBe(true)
    expect(after.steps.find((s) => s.key === 'PRICE_BOOK')!.done).toBe(false)
  })

  it('counts declines however they arrived, not whether an import ran', () => {
    // A store already using the product earns declines the ordinary way.
    // Telling them to import history they are actively generating is nonsense.
    const earned = progress(signals({ declineCount: 42, importCount: 0 }))
    expect(earned.steps.find((s) => s.key === 'HISTORY_IMPORTED')!.done).toBe(true)
  })

  it('accepts an invitation as evidence somebody thought about the roster', () => {
    const invited = progress(signals({ staffCount: 1, pendingInvites: 2 }))
    expect(invited.steps.find((s) => s.key === 'TEAM_INVITED')!.done).toBe(true)
  })

  it('does not count the founder alone as a team', () => {
    expect(progress(signals({ staffCount: 1 })).steps.find((s) => s.key === 'TEAM_INVITED')!.done)
      .toBe(false)
  })

  it('accepts either tax rate being set', () => {
    expect(progress(signals({ laborTaxRate: 0.0825 })).steps.find((s) => s.key === 'TAX_RATES')!.done)
      .toBe(true)
  })
})

describe('steps that need a person, because a default is not a decision', () => {
  it('stays undone until acknowledged, however the store is configured', () => {
    /*
      The thresholds default to zero and zero — the safe reading of a law that
      varies by state, and also what the column looks like if nobody has ever
      opened the page. No amount of data distinguishes those two.
    */
    const configured = progress(signals({ laborRate: 195, opCodeCount: 400, declineCount: 9 }))
    expect(configured.steps.find((s) => s.key === 'REAUTH_THRESHOLDS')!.done).toBe(false)
  })

  it('completes once confirmed', () => {
    const p = progress(signals({ acknowledged: new Set(['REAUTH_THRESHOLDS', 'QUIET_HOURS']) }))
    expect(p.steps.find((s) => s.key === 'REAUTH_THRESHOLDS')!.done).toBe(true)
    expect(p.steps.find((s) => s.key === 'QUIET_HOURS')!.done).toBe(true)
  })

  it('exposes exactly the two that can be ticked', () => {
    // Anything else is observed, and offering a tick box for it would let
    // somebody mark a step done that is not.
    expect([...ACKNOWLEDGEABLE].sort()).toEqual(['QUIET_HOURS', 'REAUTH_THRESHOLDS'])
    expect(isAcknowledgeable('PRICE_BOOK')).toBe(false)
    expect(isAcknowledgeable('LABOR_RATE')).toBe(false)
    expect(isAcknowledgeable('nonsense')).toBe(false)
  })

  it('ignores an acknowledgement of a step that is not acknowledgeable', () => {
    // Belt and braces: a stray row must not turn a derived step green.
    const p = progress(signals({ acknowledged: new Set(['PRICE_BOOK']) }))
    expect(p.steps.find((s) => s.key === 'PRICE_BOOK')!.done).toBe(false)
  })
})

describe('ready for the drive', () => {
  it('turns true on the essentials alone', () => {
    // The recommended steps genuinely are recommended. Withholding "you are
    // set up" until every box is green would make the message meaningless.
    const p = progress(signals({ laborRate: 195, opCodeCount: 400, declineCount: 1200 }))
    expect(p.readyForTheDrive).toBe(true)
    expect(p.doneCount).toBeLessThan(p.totalCount)
  })

  it('stays false while any essential is missing', () => {
    const p = progress(signals({
      laborRate: 195,
      opCodeCount: 400,
      partsTaxRate: 0.0825,
      staffCount: 6,
      acknowledged: new Set(['REAUTH_THRESHOLDS', 'QUIET_HOURS']),
    }))
    expect(p.readyForTheDrive).toBe(false)
    expect(p.outstandingEssential.map((s) => s.key)).toEqual(['HISTORY_IMPORTED'])
  })
})

describe('the activation metric', () => {
  it('is null until a menu reaches a customer', () => {
    expect(progress(signals()).daysToFirstMenu).toBeNull()
  })

  it('counts days from signing up to the first menu', () => {
    const p = progress(signals({
      presentationCount: 3,
      firstPresentationAt: new Date('2026-06-12T00:00:00.000Z'),
    }))
    expect(p.daysToFirstMenu).toBe(11)
  })

  it('never goes negative when a presentation predates the store record', () => {
    // Reachable after a backfill or a re-provisioning. A negative activation
    // time on the console reads as a broken metric.
    const p = progress(signals({
      presentationCount: 1,
      firstPresentationAt: new Date('2026-05-01T00:00:00.000Z'),
    }))
    expect(p.daysToFirstMenu).toBe(0)
  })
})
