import { describe, expect, it } from 'vitest'
import {
  averagePerRepairOrder, buildInsights, buildScorecard, buildStreaks, buildVisitSummary,
  captureRate, changeVsPrevious, coveredRevenueUnlocked, easyYesCaptureRate, isEasyYes,
  latestActivity, leftOnTable, monthToDatePeriod, periodIsEmpty, startOfWeek, toOutcome,
  toOutcomeRecords, visitsWorked, weekPeriod,
} from './index'
import type { OutcomeRecord, SoldLineRecord } from './types'
import type { Opportunity } from '@/lib/prep-sheet'

function outcome(over: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    appointmentId: 'a1',
    opportunityKey: 'WEAR_PREDICTED-0',
    opportunityType: 'WEAR_PREDICTED',
    title: 'Tires approaching replacement',
    urgency: 'HIGH',
    likelyPayer: 'CUSTOMER_PAY',
    estimatedAmount: 1000,
    customerOutOfPocket: 1000,
    outcome: 'ACCEPTED',
    decidedAt: new Date('2026-08-12T12:00:00Z'),
    ...over,
  }
}

function line(over: Partial<SoldLineRecord> = {}): SoldLineRecord {
  return {
    repairOrderId: 'ro1',
    closedAt: new Date('2026-08-12T12:00:00Z'),
    amount: 1000,
    customerAmount: 1000,
    payType: 'CUSTOMER_PAY',
    ...over,
  }
}

describe('isEasyYes', () => {
  it('counts anything the customer pays nothing for', () => {
    expect(isEasyYes(outcome({ likelyPayer: 'PPM', customerOutOfPocket: 0 }))).toBe(true)
  })

  it('counts a small deductible against a large job', () => {
    expect(
      isEasyYes(outcome({ likelyPayer: 'VSC', estimatedAmount: 1000, customerOutOfPocket: 100 })),
    ).toBe(true)
  })

  it('does not count a job that is mostly customer pay', () => {
    expect(
      isEasyYes(outcome({ likelyPayer: 'VSC', estimatedAmount: 1000, customerOutOfPocket: 600 })),
    ).toBe(false)
  })

  it('never counts straight customer pay, even at zero', () => {
    // A $0 customer-pay line is a data error, not an easy yes.
    expect(isEasyYes(outcome({ likelyPayer: 'CUSTOMER_PAY', customerOutOfPocket: 0 }))).toBe(false)
  })
})

describe('captureRate', () => {
  it('counts a decline as presented — the advisor did their job', () => {
    // This is the whole philosophy of the metric: it measures presenting, not
    // closing. An advisor controls the first and not the second.
    const rate = captureRate([outcome({ outcome: 'DECLINED' }), outcome({ outcome: 'ACCEPTED' })])
    expect(rate).toBe(100)
  })

  it('only penalises items that were never raised', () => {
    const rate = captureRate([
      outcome({ outcome: 'ACCEPTED' }),
      outcome({ outcome: 'DECLINED' }),
      outcome({ outcome: 'SKIPPED' }),
      outcome({ outcome: 'SKIPPED' }),
    ])
    expect(rate).toBe(50)
  })

  it('is zero rather than NaN with nothing to measure', () => {
    expect(captureRate([])).toBe(0)
  })
})

describe('easyYesCaptureRate', () => {
  it('ignores customer-pay items entirely', () => {
    const rate = easyYesCaptureRate([
      outcome({ likelyPayer: 'PPM', customerOutOfPocket: 0, outcome: 'ACCEPTED' }),
      outcome({ likelyPayer: 'CUSTOMER_PAY', outcome: 'SKIPPED' }),
    ])
    expect(rate).toBe(100)
  })

  it('is zero when there were no easy-yes items at all', () => {
    expect(easyYesCaptureRate([outcome({ likelyPayer: 'CUSTOMER_PAY' })])).toBe(0)
  })
})

describe('coveredRevenueUnlocked', () => {
  it('counts only the part coverage carried', () => {
    const total = coveredRevenueUnlocked([
      line({ amount: 1000, customerAmount: 100 }),
      line({ amount: 500, customerAmount: 500 }),
    ])
    expect(total).toBe(900)
  })

  it('never goes negative when the customer paid more than the line', () => {
    expect(coveredRevenueUnlocked([line({ amount: 100, customerAmount: 150 })])).toBe(0)
  })
})

describe('averagePerRepairOrder', () => {
  it('averages by repair order, not by line', () => {
    // Three lines on two ROs is two tickets, not three.
    const avg = averagePerRepairOrder([
      line({ repairOrderId: 'ro1', amount: 400 }),
      line({ repairOrderId: 'ro1', amount: 600 }),
      line({ repairOrderId: 'ro2', amount: 500 }),
    ])
    expect(avg).toBe(750)
  })

  it('is zero with no lines', () => {
    expect(averagePerRepairOrder([])).toBe(0)
  })
})

describe('changeVsPrevious', () => {
  it('reports a real change', () => {
    expect(changeVsPrevious(120, 100)).toBe(20)
  })

  it('returns null when there is nothing to compare against', () => {
    // "No change" and "no basis" are different, and a flat arrow for the second
    // is a lie an advisor will act on.
    expect(changeVsPrevious(50, 0)).toBeNull()
    expect(changeVsPrevious(50, null)).toBeNull()
  })
})

describe('leftOnTable and visitsWorked', () => {
  it('sums only what was never raised', () => {
    expect(
      leftOnTable([
        outcome({ outcome: 'SKIPPED', estimatedAmount: 300 }),
        outcome({ outcome: 'DECLINED', estimatedAmount: 900 }),
      ]),
    ).toBe(300)
  })

  it('counts distinct appointments', () => {
    expect(
      visitsWorked([outcome({ appointmentId: 'a1' }), outcome({ appointmentId: 'a1' }), outcome({ appointmentId: 'a2' })]),
    ).toBe(2)
  })
})

describe('buildStreaks', () => {
  const visit = (id: string, day: number, outcomes: Partial<OutcomeRecord>[]) =>
    outcomes.map((o) =>
      outcome({ appointmentId: id, decidedAt: new Date(`2026-08-${String(day).padStart(2, '0')}T12:00:00Z`), ...o }),
    )

  it('counts consecutive fully-presented visits from the most recent', () => {
    const records = [
      ...visit('a1', 10, [{ outcome: 'ACCEPTED' }, { outcome: 'DECLINED' }]),
      ...visit('a2', 11, [{ outcome: 'ACCEPTED' }]),
      ...visit('a3', 12, [{ outcome: 'DECLINED' }]),
    ]
    const streak = buildStreaks(records).find((s) => s.key === 'full-presentation')!
    expect(streak.current).toBe(3)
  })

  it('breaks the run on a visit with a skip', () => {
    const records = [
      ...visit('a1', 10, [{ outcome: 'ACCEPTED' }]),
      ...visit('a2', 11, [{ outcome: 'SKIPPED' }]),
      ...visit('a3', 12, [{ outcome: 'ACCEPTED' }]),
    ]
    const streak = buildStreaks(records).find((s) => s.key === 'full-presentation')!
    expect(streak.current).toBe(1)
    expect(streak.best).toBe(1)
  })

  it('does not break an easy-yes run on a visit that had none', () => {
    // A streak that punishes an advisor for a visit with no covered items is
    // punishing them for the customer's contract, not their own work.
    const records = [
      ...visit('a1', 10, [{ likelyPayer: 'PPM', customerOutOfPocket: 0, outcome: 'ACCEPTED' }]),
      ...visit('a2', 11, [{ likelyPayer: 'CUSTOMER_PAY', outcome: 'SKIPPED' }]),
      ...visit('a3', 12, [{ likelyPayer: 'PPM', customerOutOfPocket: 0, outcome: 'ACCEPTED' }]),
    ]
    const streak = buildStreaks(records).find((s) => s.key === 'easy-yes')!
    expect(streak.current).toBe(3)
  })
})

describe('buildInsights', () => {
  it('puts a skipped safety item above everything else', () => {
    const insights = buildInsights([
      outcome({ urgency: 'SAFETY', outcome: 'SKIPPED', title: 'Brake pads at 2mm' }),
      outcome({ outcome: 'ACCEPTED' }),
    ])
    expect(insights[0]?.key).toBe('skipped-safety')
    expect(insights[0]?.detail).toContain('Brake pads at 2mm')
  })

  it('stays quiet on a sample too small to mean anything', () => {
    // Two visits is not a trend, and coaching on noise destroys trust in the page.
    const insights = buildInsights([outcome({ outcome: 'SKIPPED' }), outcome({ outcome: 'ACCEPTED' })])
    expect(insights.find((i) => i.key === 'low-capture')).toBeUndefined()
  })

  it('celebrates a genuinely strong week', () => {
    const records = Array.from({ length: 10 }, () => outcome({ outcome: 'ACCEPTED' }))
    expect(buildInsights(records).some((i) => i.tone === 'CELEBRATE')).toBe(true)
  })

  it('says nothing at all with no data', () => {
    expect(buildInsights([])).toEqual([])
  })
})

describe('buildScorecard', () => {
  const period = { start: new Date('2026-08-10T00:00:00Z'), end: new Date('2026-08-17T00:00:00Z'), label: 'This week' }
  const prior = { start: new Date('2026-08-03T00:00:00Z'), end: new Date('2026-08-10T00:00:00Z'), label: 'Last week' }

  it('ignores records outside the period', () => {
    const card = buildScorecard({
      outcomes: [
        outcome({ decidedAt: new Date('2026-08-12T12:00:00Z') }),
        outcome({ decidedAt: new Date('2026-07-01T12:00:00Z'), appointmentId: 'old' }),
      ],
      soldLines: [],
      period,
    })
    expect(card.visitsWorked).toBe(1)
  })

  it('compares against the previous period when given one', () => {
    const card = buildScorecard({
      outcomes: [
        outcome({ decidedAt: new Date('2026-08-12T12:00:00Z'), outcome: 'ACCEPTED' }),
        outcome({ decidedAt: new Date('2026-08-05T12:00:00Z'), appointmentId: 'a0', outcome: 'SKIPPED' }),
      ],
      soldLines: [],
      period,
      previousPeriod: prior,
    })
    const capture = card.metrics.find((m) => m.key === 'captureRate')!
    // 100% this week against 0% last week: no valid basis, so no false arrow.
    expect(capture.value).toBe(100)
    expect(capture.changePercent).toBeNull()
  })

  it('counts streaks across all history, not just the period', () => {
    const card = buildScorecard({
      outcomes: [
        outcome({ appointmentId: 'a1', decidedAt: new Date('2026-08-12T12:00:00Z') }),
        outcome({ appointmentId: 'a0', decidedAt: new Date('2026-08-04T12:00:00Z') }),
      ],
      soldLines: [],
      period,
    })
    expect(card.streaks.find((s) => s.key === 'full-presentation')?.current).toBe(2)
  })
})

describe('latestActivity and periodIsEmpty', () => {
  const period = { start: new Date('2026-08-10T00:00:00Z'), end: new Date('2026-08-17T00:00:00Z'), label: 'This week' }

  it('takes the most recent date across both sources', () => {
    const at = latestActivity(
      [outcome({ decidedAt: new Date('2026-03-01T12:00:00Z') })],
      [line({ closedAt: new Date('2026-06-01T12:00:00Z') })],
    )
    expect(at?.toISOString()).toBe(new Date('2026-06-01T12:00:00Z').toISOString())
  })

  it('is null when the advisor has no history at all', () => {
    expect(latestActivity([], [])).toBeNull()
  })

  it('reports an empty week so the page can fall back instead of showing zeros', () => {
    // "0% capture" and "you weren't working" are different facts.
    expect(periodIsEmpty([outcome({ decidedAt: new Date('2026-03-01T12:00:00Z') })], [], period)).toBe(true)
  })

  it('is not empty when either source has something in the window', () => {
    expect(periodIsEmpty([], [line({ closedAt: new Date('2026-08-12T12:00:00Z') })], period)).toBe(false)
  })
})

describe('weekPeriod', () => {
  it('starts the week on Monday', () => {
    // A Sunday reset splits Saturday off from the week it belongs to.
    expect(startOfWeek(new Date(2026, 7, 13)).getDay()).toBe(1)
  })

  it('walks back whole weeks', () => {
    const thisWeek = weekPeriod(new Date(2026, 7, 13))
    const lastWeek = weekPeriod(new Date(2026, 7, 13), 1)
    expect(thisWeek.start.getTime() - lastWeek.start.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
    expect(lastWeek.end.getTime()).toBe(thisWeek.start.getTime())
  })
})

// ===========================================================================

function opportunity(over: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'WEAR_PREDICTED-0',
    type: 'WEAR_PREDICTED',
    title: 'Tires approaching replacement',
    detail: 'Worst corner RF at 4/32".',
    estimatedAmount: 1000,
    customerOutOfPocket: 1000,
    likelyPayer: 'CUSTOMER_PAY',
    urgency: 'HIGH',
    closeProbability: 0.5,
    priorityScore: 80,
    talkTrack: 'Show the trend.',
    ...over,
  }
}

describe('toOutcome', () => {
  it('treats an untouched item as skipped, not as missing data', () => {
    expect(toOutcome('PENDING')).toBe('SKIPPED')
    expect(toOutcome('SKIPPED')).toBe('SKIPPED')
  })

  it('maps the real decisions straight through', () => {
    expect(toOutcome('ACCEPTED')).toBe('ACCEPTED')
    expect(toOutcome('DECLINED')).toBe('DECLINED')
  })
})

describe('toOutcomeRecords', () => {
  it('snapshots the price rather than referencing it', () => {
    const records = toOutcomeRecords('a1', [opportunity()], {}, new Date('2026-08-12T12:00:00Z'))
    expect(records[0]?.estimatedAmount).toBe(1000)
    expect(records[0]?.outcome).toBe('SKIPPED')
  })
})

describe('buildVisitSummary', () => {
  it('counts presented against available', () => {
    const summary = buildVisitSummary(
      [opportunity({ id: 'o1' }), opportunity({ id: 'o2' }), opportunity({ id: 'o3' })],
      { o1: 'ACCEPTED', o2: 'DECLINED' },
    )
    expect(summary.presented).toBe(2)
    expect(summary.available).toBe(3)
    expect(summary.capturePercent).toBeCloseTo(66.67, 1)
  })

  it('reports what coverage carried on accepted work', () => {
    const summary = buildVisitSummary(
      [opportunity({ id: 'o1', estimatedAmount: 1000, customerOutOfPocket: 100 })],
      { o1: 'ACCEPTED' },
    )
    expect(summary.coveredUnlocked).toBe(900)
    expect(summary.acceptedValue).toBe(1000)
  })

  it('coaches on a skipped safety item ahead of a bigger-dollar miss', () => {
    const summary = buildVisitSummary(
      [
        opportunity({ id: 'o1', urgency: 'SAFETY', title: 'Brake pads at 2mm', estimatedAmount: 300 }),
        opportunity({ id: 'o2', title: 'Transmission service', estimatedAmount: 900 }),
      ],
      {},
    )
    expect(summary.coaching).toContain('Brake pads at 2mm')
  })

  it('coaches on a covered miss ahead of a larger customer-pay one', () => {
    const summary = buildVisitSummary(
      [
        opportunity({ id: 'o1', likelyPayer: 'PPM', customerOutOfPocket: 0, title: 'Prepaid oil change', estimatedAmount: 80 }),
        opportunity({ id: 'o2', title: 'Transmission service', estimatedAmount: 900 }),
      ],
      {},
    )
    expect(summary.coaching).toContain('Prepaid oil change')
  })

  it('stays silent rather than manufacturing a nitpick', () => {
    const summary = buildVisitSummary([opportunity({ id: 'o1', estimatedAmount: 29 })], {})
    expect(summary.coaching).toBeNull()
  })

  it('praises only a visit where everything was presented', () => {
    const full = buildVisitSummary([opportunity({ id: 'o1' })], { o1: 'DECLINED' })
    expect(full.praise).not.toBeNull()

    const partial = buildVisitSummary([opportunity({ id: 'o1' }), opportunity({ id: 'o2' })], {
      o1: 'DECLINED',
    })
    expect(partial.praise).toBeNull()
  })

  it('does not praise an empty sheet', () => {
    expect(buildVisitSummary([], {}).praise).toBeNull()
  })
})

describe('monthToDatePeriod', () => {
  const asOf = new Date(2026, 7, 12, 14, 0) // Wed 12 August 2026

  it('runs from the first of the month through the end of today', () => {
    const p = monthToDatePeriod(asOf)
    expect(p.start).toEqual(new Date(2026, 7, 1))
    expect(p.end).toEqual(new Date(2026, 7, 13))
  })

  it('compares against the same number of days of the previous month', () => {
    // The whole point: twelve days of August against twelve days of July, not
    // against all thirty-one. The unequal comparison reported a collapse for
    // four weeks out of every five.
    const p = monthToDatePeriod(asOf, 1)
    expect(p.start).toEqual(new Date(2026, 6, 1))
    expect(p.end).toEqual(new Date(2026, 6, 13))
  })

  it('never runs past the end of a shorter month', () => {
    // 31 March compared against February, which has no 31st.
    const p = monthToDatePeriod(new Date(2026, 2, 31, 9, 0), 1)
    expect(p.start).toEqual(new Date(2026, 1, 1))
    expect(p.end).toEqual(new Date(2026, 2, 1))
  })

  it('handles the first of the month as a single day', () => {
    const p = monthToDatePeriod(new Date(2026, 7, 1, 9, 0))
    expect(p.start).toEqual(new Date(2026, 7, 1))
    expect(p.end).toEqual(new Date(2026, 7, 2))
  })

  it('crosses a year boundary', () => {
    const p = monthToDatePeriod(new Date(2026, 0, 10, 9, 0), 1)
    expect(p.start).toEqual(new Date(2025, 11, 1))
    expect(p.end).toEqual(new Date(2025, 11, 11))
  })
})
