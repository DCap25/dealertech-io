import { describe, expect, it } from 'vitest'
import { soldComponentGroups, type ClosedLine } from './sold-work'

const line = (over: Partial<ClosedLine> = {}): ClosedLine => ({
  componentGroupKey: 'COOLANT_SERVICE',
  status: 'APPROVED',
  ...over,
})

describe('soldComponentGroups', () => {
  it('counts work that was approved or completed', () => {
    const groups = soldComponentGroups([
      line({ componentGroupKey: 'COOLANT_SERVICE', status: 'APPROVED' }),
      line({ componentGroupKey: 'TIRE_ROTATION', status: 'COMPLETE' }),
    ])
    expect(groups.sort()).toEqual(['COOLANT_SERVICE', 'TIRE_ROTATION'])
  })

  it('does not count a line declined on this very RO', () => {
    // The regression that matters most. Reading a decline as a resolution
    // would erase the open declined work at the moment it was created —
    // silently emptying the largest revenue pool in the shop.
    expect(soldComponentGroups([line({ status: 'DECLINED' })])).toEqual([])
  })

  it('does not count work that was only recommended', () => {
    expect(soldComponentGroups([line({ status: 'RECOMMENDED' })])).toEqual([])
  })

  it('ignores lines with no component group', () => {
    // A shop-supplies or sublet line has nothing to reconcile against, and a
    // null must never be treated as a group that other nulls match.
    expect(soldComponentGroups([line({ componentGroupKey: null })])).toEqual([])
  })

  it('counts warranty and internal work the same as customer pay', () => {
    // Pay type is not consulted at all: the job is done either way, so nobody
    // should be rung up about it. Who paid is a different question.
    expect(soldComponentGroups([line({ status: 'COMPLETE' })])).toEqual(['COOLANT_SERVICE'])
  })

  it('collapses duplicates so the same group is settled once', () => {
    expect(
      soldComponentGroups([
        line({ componentGroupKey: 'BRAKE_PADS_SHOES' }),
        line({ componentGroupKey: 'BRAKE_PADS_SHOES', status: 'COMPLETE' }),
      ]),
    ).toEqual(['BRAKE_PADS_SHOES'])
  })

  it('settles nothing on an empty or all-declined RO', () => {
    expect(soldComponentGroups([])).toEqual([])
    expect(
      soldComponentGroups([
        line({ status: 'DECLINED' }),
        line({ componentGroupKey: 'TIRES', status: 'DECLINED' }),
      ]),
    ).toEqual([])
  })
})
