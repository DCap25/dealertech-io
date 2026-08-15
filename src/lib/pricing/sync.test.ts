import { describe, expect, it } from 'vitest'
import {
  describePlan, planPriceSync, type ExistingPrice, type IncomingPrice,
} from './sync'

const held = (over: Partial<ExistingPrice> = {}): ExistingPrice => ({
  id: 'op-1',
  code: 'LOF',
  description: 'Lube, Oil & Filter',
  laborHours: 0.5,
  laborAmount: 39,
  partsAmount: 45,
  isActive: true,
  ...over,
})

const incoming = (over: Partial<IncomingPrice> = {}): IncomingPrice => ({
  code: 'LOF',
  description: 'Lube, Oil & Filter',
  laborHours: 0.5,
  laborAmount: 39,
  partsAmount: 45,
  ...over,
})

/** A book big enough that the shrinkage guard is not what is being tested. */
function book(n: number): { existing: ExistingPrice[]; incoming: IncomingPrice[] } {
  const existing: ExistingPrice[] = []
  const rows: IncomingPrice[] = []
  for (let i = 0; i < n; i++) {
    existing.push(held({ id: `op-${i}`, code: `OP${i}` }))
    rows.push(incoming({ code: `OP${i}` }))
  }
  return { existing, incoming: rows }
}

describe('planPriceSync — the ordinary morning', () => {
  it('does nothing when no price moved', () => {
    const { existing, incoming: rows } = book(10)
    const result = planPriceSync(rows, existing)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.unchanged).toBe(10)
    expect(result.plan.update).toHaveLength(0)
  })

  it('picks up a price rise', () => {
    const { existing, incoming: rows } = book(10)
    rows[0] = incoming({ code: 'OP0', laborAmount: 42 })
    const result = planPriceSync(rows, existing)
    if (!result.ok) throw new Error('refused')
    expect(result.plan.update).toHaveLength(1)
    expect(result.plan.update[0]?.after.laborAmount).toBe(42)
    expect(result.plan.unchanged).toBe(9)
  })

  it('adds an operation the dealership just created', () => {
    const { existing, incoming: rows } = book(10)
    rows.push(incoming({ code: 'NEW-1', description: 'Cabin Filter' }))
    const result = planPriceSync(rows, existing)
    if (!result.ok) throw new Error('refused')
    expect(result.plan.create.map((c) => c.code)).toEqual(['NEW-1'])
  })

  it('retires a handful the DMS stopped listing, without deleting them', () => {
    const { existing, incoming: rows } = book(20)
    rows.splice(0, 2) // two of twenty — under the shrinkage ceiling
    const result = planPriceSync(rows, existing)
    if (!result.ok) throw new Error('refused')
    expect(result.plan.deactivate.map((d) => d.code).sort()).toEqual(['OP0', 'OP1'])
  })

  it('brings back a code the DMS started listing again', () => {
    const existing = [held({ isActive: false })]
    const result = planPriceSync([incoming()], existing)
    if (!result.ok) throw new Error('refused')
    expect(result.plan.reactivate.map((r) => r.code)).toEqual(['LOF'])
  })

  it('ignores rounding noise below a cent', () => {
    const result = planPriceSync([incoming({ laborAmount: 39.001 })], [held()])
    if (!result.ok) throw new Error('refused')
    expect(result.plan.update).toHaveLength(0)
    expect(result.plan.unchanged).toBe(1)
  })
})

describe('planPriceSync — refusing a bad pull', () => {
  it('refuses an empty pull when a book is on file', () => {
    // An expired credential looks exactly like "this dealership has no op
    // codes", and the difference is the entire price book.
    const result = planPriceSync([], [held()])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal.kind).toBe('EMPTY_PULL')
    expect(result.refusal.message).toMatch(/nothing was changed/)
  })

  it('accepts an empty pull for a store with no book yet', () => {
    // A brand-new rooftop legitimately has nothing. A first sync that finds
    // nothing is a quiet morning, not a failure.
    const result = planPriceSync([], [])
    expect(result.ok).toBe(true)
  })

  it('refuses when too much of the book vanished overnight', () => {
    // A dealership does not retire a fifth of its operations in one night. A
    // pull that timed out halfway through looks precisely like this.
    const { existing, incoming: rows } = book(20)
    rows.splice(0, 6) // 30% missing
    const result = planPriceSync(rows, existing)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal.kind).toBe('SUSPICIOUS_SHRINKAGE')
    expect(result.refusal.message).toContain('30%')
  })

  it('refuses rather than applying the half of the plan that looked fine', () => {
    // A half-applied price book is harder to reason about than one that did
    // not change at all.
    const { existing, incoming: rows } = book(20)
    rows.splice(0, 6)
    rows[0] = incoming({ code: rows[0]!.code, laborAmount: 999 })
    const result = planPriceSync(rows, existing)
    expect(result.ok).toBe(false)
  })

  it('counts only active codes as the book it is protecting', () => {
    // Codes already retired must not make a healthy pull look like shrinkage.
    const existing = [
      ...book(10).existing,
      held({ id: 'old-1', code: 'GONE-1', isActive: false }),
      held({ id: 'old-2', code: 'GONE-2', isActive: false }),
    ]
    const result = planPriceSync(book(10).incoming, existing)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.deactivate).toHaveLength(0)
  })
})

describe('planPriceSync — units errors', () => {
  it('holds back a price that jumped by a factor of a hundred', () => {
    // Cents read as dollars. $618 of brakes presented to a customer as
    // $61,800 is not a pricing error, it is an incident.
    const result = planPriceSync(
      [incoming({ laborAmount: 3_900, partsAmount: 4_500 })],
      [held()],
    )
    if (!result.ok) throw new Error('refused')
    expect(result.plan.quarantined).toHaveLength(1)
    expect(result.plan.update).toHaveLength(0)
  })

  it('holds back a collapse as well as a jump', () => {
    const result = planPriceSync(
      [incoming({ laborAmount: 0.39, partsAmount: 0.45 })],
      [held()],
    )
    if (!result.ok) throw new Error('refused')
    expect(result.plan.quarantined).toHaveLength(1)
  })

  it('lets a real price rise through', () => {
    // The guard has to be far enough above genuine movement to never argue
    // with a supplier increase.
    const result = planPriceSync([incoming({ partsAmount: 62 })], [held()])
    if (!result.ok) throw new Error('refused')
    expect(result.plan.update).toHaveLength(1)
    expect(result.plan.quarantined).toHaveLength(0)
  })

  it('does not second-guess a code becoming free, or stopping being free', () => {
    // A multi-point inspection going to £0 is somebody's decision in the DMS,
    // not a units error. Ratios are meaningless against zero.
    const toFree = planPriceSync([incoming({ laborAmount: 0, partsAmount: 0 })], [held()])
    if (!toFree.ok) throw new Error('refused')
    expect(toFree.plan.update).toHaveLength(1)

    const fromFree = planPriceSync(
      [incoming({ laborAmount: 39, partsAmount: 45 })],
      [held({ laborAmount: 0, partsAmount: 0 })],
    )
    if (!fromFree.ok) throw new Error('refused')
    expect(fromFree.plan.update).toHaveLength(1)
  })

  it('still applies everything else in the same batch', () => {
    // One bad row must not cost the dealership a morning of real updates.
    const { existing, incoming: rows } = book(10)
    rows[0] = incoming({ code: 'OP0', laborAmount: 50_000 })
    rows[1] = incoming({ code: 'OP1', laborAmount: 44 })
    const result = planPriceSync(rows, existing)
    if (!result.ok) throw new Error('refused')
    expect(result.plan.quarantined.map((q) => q.code)).toEqual(['OP0'])
    expect(result.plan.update.map((u) => u.code)).toEqual(['OP1'])
  })
})

describe('describePlan', () => {
  it('shouts about held-back rows and stays quiet when there are none', () => {
    const { existing, incoming: rows } = book(10)
    const clean = planPriceSync(rows, existing)
    if (!clean.ok) throw new Error('refused')
    expect(describePlan(clean.plan)).not.toMatch(/HELD BACK/)

    rows[0] = incoming({ code: 'OP0', laborAmount: 50_000 })
    const dirty = planPriceSync(rows, existing)
    if (!dirty.ok) throw new Error('refused')
    expect(describePlan(dirty.plan)).toMatch(/1 HELD BACK/)
  })
})
