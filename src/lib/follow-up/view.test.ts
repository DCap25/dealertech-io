import { describe, expect, it } from 'vitest'
import {
  buildTextPrompt, canCall, canText, classifyUrgency, contactBlockedReason, filterItems,
  groupByUrgency, overdueDays, ownerFrom, summarize, triggerMeta, type FollowUpItem,
} from './view'

const ASOF = new Date('2026-08-12T12:00:00Z')

function item(over: Partial<FollowUpItem> = {}): FollowUpItem {
  return {
    id: 't1',
    trigger: 'DECLINED_SERVICE_FOLLOW_UP',
    title: 'Re-offer Four Wheel Alignment',
    detail: 'Declined 7 months ago at 33,290 miles.',
    talkTrack: 'Reference the exact item.',
    estimatedValue: 149,
    priority: 20,
    dueAt: new Date('2026-08-12T09:00:00Z'),
    status: 'PENDING',
    customerId: 'c1',
    customerName: 'Maria Perez',
    customerPhone: '5125550142',
    preferredChannel: 'SMS',
    doNotCall: false,
    vehicleId: 'v1',
    vehicleLabel: '2021 HYUNDAI Tucson',
    vehicleMileage: 51140,
    visitCount: 6,
    lifetimeSpend: 1412,
    lastVisitAt: null,
    assignToRole: 'BDC',
    owner: 'BDC',
    smsConsent: true,
    ...over,
  }
}

describe('ownerFrom', () => {
  it('maps the roles the cadence rules actually use', () => {
    expect(ownerFrom('ADVISOR')).toBe('ADVISOR')
    expect(ownerFrom('BDC')).toBe('BDC')
  })

  it('treats a missing or unknown role as unassigned rather than guessing', () => {
    expect(ownerFrom(null)).toBe('UNASSIGNED')
    expect(ownerFrom('MANAGER')).toBe('UNASSIGNED')
  })
})

describe('overdueDays and classifyUrgency', () => {
  it('compares whole days, not timestamps', () => {
    // A task due at 9am is not "overdue" at 12pm the same day — it is due today.
    expect(overdueDays(new Date('2026-08-12T09:00:00Z'), ASOF)).toBe(0)
    expect(classifyUrgency(new Date('2026-08-12T09:00:00Z'), ASOF)).toBe('TODAY')
  })

  it('counts real overdue days', () => {
    expect(overdueDays(new Date('2026-08-09T09:00:00Z'), ASOF)).toBe(3)
    expect(classifyUrgency(new Date('2026-08-09T09:00:00Z'), ASOF)).toBe('OVERDUE')
  })

  it('treats a future due date as upcoming', () => {
    expect(classifyUrgency(new Date('2026-08-20T09:00:00Z'), ASOF)).toBe('UPCOMING')
  })
})

describe('triggerMeta', () => {
  it('marks the four types that actually leak money', () => {
    expect(triggerMeta('DECLINED_SERVICE_FOLLOW_UP').highValue).toBe(true)
    expect(triggerMeta('PPM_EXPIRING').highValue).toBe(true)
    expect(triggerMeta('WARRANTY_EXPIRING').highValue).toBe(true)
    expect(triggerMeta('DORMANT_CUSTOMER').highValue).toBe(true)
  })

  it('does not inflate routine courtesy calls', () => {
    expect(triggerMeta('POST_VISIT_THANK_YOU').highValue).toBe(false)
    expect(triggerMeta('CSI_PRE_EMPTION').highValue).toBe(false)
  })

  it('falls back rather than throwing on an unmapped trigger', () => {
    expect(triggerMeta('SOMETHING_NEW').label).toBe('Follow-up')
  })
})

describe('filterItems', () => {
  const items = [
    item({ id: 'a', owner: 'ADVISOR', trigger: 'CSI_PRE_EMPTION' }),
    item({ id: 'b', owner: 'BDC', trigger: 'DECLINED_SERVICE_FOLLOW_UP' }),
    item({ id: 'c', owner: 'BDC', trigger: 'POST_VISIT_THANK_YOU' }),
  ]

  it('narrows to one owner', () => {
    expect(filterItems(items, { owner: 'ADVISOR' }).map((i) => i.id)).toEqual(['a'])
  })

  it('treats ALL and no filter the same', () => {
    expect(filterItems(items, { owner: 'ALL' })).toHaveLength(3)
    expect(filterItems(items, {})).toHaveLength(3)
  })

  it('narrows to one trigger', () => {
    expect(filterItems(items, { trigger: 'POST_VISIT_THANK_YOU' }).map((i) => i.id)).toEqual(['c'])
  })

  it('keeps only the money-leaking types when asked', () => {
    expect(filterItems(items, { highValueOnly: true }).map((i) => i.id)).toEqual(['b'])
  })

  it('combines filters', () => {
    expect(filterItems(items, { owner: 'BDC', highValueOnly: true }).map((i) => i.id)).toEqual(['b'])
  })
})

describe('groupByUrgency', () => {
  it('orders overdue before today before upcoming', () => {
    const sections = groupByUrgency(
      [
        item({ id: 'up', dueAt: new Date('2026-08-20T09:00:00Z') }),
        item({ id: 'od', dueAt: new Date('2026-08-01T09:00:00Z') }),
        item({ id: 'td', dueAt: new Date('2026-08-12T09:00:00Z') }),
      ],
      ASOF,
    )
    expect(sections.map((s) => s.urgency)).toEqual(['OVERDUE', 'TODAY', 'UPCOMING'])
  })

  it('drops empty bands instead of rendering a heading over nothing', () => {
    const sections = groupByUrgency([item({ dueAt: new Date('2026-08-12T09:00:00Z') })], ASOF)
    expect(sections).toHaveLength(1)
    expect(sections[0]?.urgency).toBe('TODAY')
  })

  it('preserves the engine ordering inside a band', () => {
    // The cadence engine already ranked these; re-sorting here would mean two
    // different orders inside one product.
    const sections = groupByUrgency(
      [item({ id: 'first', estimatedValue: 10 }), item({ id: 'second', estimatedValue: 9000 })],
      ASOF,
    )
    expect(sections[0]?.items.map((i) => i.id)).toEqual(['first', 'second'])
  })

  it('returns nothing for an empty list', () => {
    expect(groupByUrgency([], ASOF)).toEqual([])
  })
})

describe('summarize', () => {
  it('totals value, overdue and high-value counts', () => {
    const summary = summarize(
      [
        item({ id: 'a', estimatedValue: 100, dueAt: new Date('2026-08-01T09:00:00Z') }),
        item({ id: 'b', estimatedValue: 400, trigger: 'POST_VISIT_THANK_YOU' }),
      ],
      ASOF,
    )
    expect(summary.count).toBe(2)
    expect(summary.value).toBe(500)
    expect(summary.overdueCount).toBe(1)
    expect(summary.highValueCount).toBe(1)
  })

  it('ranks trigger groups by value so the top chip is the biggest pool', () => {
    const summary = summarize(
      [
        item({ id: 'a', trigger: 'POST_VISIT_THANK_YOU', estimatedValue: 0 }),
        item({ id: 'b', trigger: 'DECLINED_SERVICE_FOLLOW_UP', estimatedValue: 900 }),
      ],
      ASOF,
    )
    expect(summary.byTrigger[0]?.trigger).toBe('DECLINED_SERVICE_FOLLOW_UP')
  })

  it('counts owners for the tab badges', () => {
    const summary = summarize(
      [item({ id: 'a', owner: 'BDC' }), item({ id: 'b', owner: 'BDC' }), item({ id: 'c', owner: 'ADVISOR' })],
      ASOF,
    )
    expect(summary.byOwner[0]).toEqual({ owner: 'BDC', count: 2 })
  })

  it('is all zeroes rather than NaN on an empty list', () => {
    expect(summarize([], ASOF)).toMatchObject({ count: 0, value: 0, overdueCount: 0 })
  })
})

describe('contact permissions', () => {
  it('allows a call to a consenting customer with a number', () => {
    expect(canCall(item())).toBe(true)
    expect(contactBlockedReason(item())).toBeNull()
  })

  it('blocks every channel for do-not-call', () => {
    const dnc = item({ doNotCall: true })
    expect(canCall(dnc)).toBe(false)
    expect(canText(dnc)).toBe(false)
    expect(contactBlockedReason(dnc)).toContain('not to be contacted')
  })

  it('blocks texting without SMS consent but still allows a call', () => {
    // TCPA is per-message and per-consent. A worklist that offers a text button
    // without consent on file is an exposure of $500–1,500 a message.
    const noConsent = item({ smsConsent: false })
    expect(canText(noConsent)).toBe(false)
    expect(canCall(noConsent)).toBe(true)
    expect(contactBlockedReason(noConsent)).toContain('No SMS consent')
  })

  it('blocks both when there is no number on file', () => {
    const noPhone = item({ customerPhone: null })
    expect(canCall(noPhone)).toBe(false)
    expect(canText(noPhone)).toBe(false)
    expect(contactBlockedReason(noPhone)).toContain('No phone')
  })
})

describe('buildTextPrompt', () => {
  it('uses the first name and names the store', () => {
    const text = buildTextPrompt(item(), 'Lone Star Ford')
    expect(text).toContain('Maria')
    expect(text).toContain('Lone Star Ford')
    expect(text).not.toContain('Maria Perez')
  })

  it('references the vehicle when we know it', () => {
    expect(buildTextPrompt(item(), 'Lone Star Ford')).toContain('2021 HYUNDAI Tucson')
  })

  it('reads cleanly when the vehicle is unknown', () => {
    const text = buildTextPrompt(item({ vehicleLabel: null }), 'Lone Star Ford')
    expect(text).not.toContain('undefined')
    expect(text).not.toContain('null')
  })

  it('says the manufacturer pays on a recall rather than asking for money', () => {
    const text = buildTextPrompt(item({ trigger: 'OPEN_RECALL' }), 'Lone Star Ford')
    expect(text).toContain('no cost')
  })

  it('leads with what they already paid for on a prepaid expiry', () => {
    const text = buildTextPrompt(item({ trigger: 'PPM_EXPIRING' }), 'Lone Star Ford')
    expect(text).toContain('already paid')
  })

  it('falls back to something sendable on an unmapped trigger', () => {
    const text = buildTextPrompt(item({ trigger: 'SEASONAL' }), 'Lone Star Ford')
    expect(text.length).toBeGreaterThan(20)
    expect(text).toContain('Lone Star Ford')
  })

  it('handles a single-word customer name', () => {
    expect(buildTextPrompt(item({ customerName: 'Cher' }), 'Lone Star Ford')).toContain('Cher')
  })
})
