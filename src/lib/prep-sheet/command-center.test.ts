import { describe, expect, it } from 'vitest'
import {
  buildHandoffLine, buildHandoffNote, categorize, handoffCount, recommendNext,
  stripConcernPrefix,
} from './command-center'
import type { Opportunity, PrepSheet } from './types'
import type { TermStatus } from '@/lib/warranty'

function opportunity(over: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'o1',
    type: 'WEAR_PREDICTED',
    title: 'Tires approaching replacement',
    detail: 'Worst corner RF is at 4/32".',
    componentGroupKey: 'TIRES',
    estimatedAmount: 1100,
    customerOutOfPocket: 1100,
    likelyPayer: 'CUSTOMER_PAY',
    urgency: 'HIGH',
    closeProbability: 0.5,
    priorityScore: 80,
    talkTrack: 'Show the trend.',
    ...over,
  }
}

function term(): TermStatus {
  return {
    name: 'Basic',
    term: { months: 36, miles: 36000 },
    active: false,
    monthsRemaining: 0,
    milesRemaining: 0,
    expiresOn: null,
    expiresAtMiles: null,
    limitingFactor: 'TIME',
    expiredBy: 'TIME',
  }
}

function sheet(over: Partial<PrepSheet> = {}): PrepSheet {
  return {
    customer: {
      id: 'c1', name: 'Maria Perez', visitCount: 6, lifetimeSpend: 1412,
      lastVisitAt: null, preferredChannel: 'SMS', pinnedNotes: [],
    },
    vehicle: {
      id: 'v1', vin: '5NP8BCFL4M04TB0CT', make: 'HYUNDAI', model: 'Tucson', modelYear: 2021,
      inServiceDate: null, currentMileage: 51140, avgMilesPerDay: 28,
      isHybridOrEv: false, isOriginalOwner: true,
    },
    appointment: {
      id: 'a1', scheduledAt: new Date('2026-08-12T12:00:00Z'), promisedAt: null,
      transportType: 'WAITER', concerns: 'Noise from front end over bumps', advisorName: 'Marcus Reyes',
    },
    warranty: {
      make: 'HYUNDAI', modelYear: 2021, known: true, program: undefined,
      basic: null, powertrain: null, corrosion: null,
      emissionsLong: term(), emissionsShort: term(), hybridEv: null, warnings: [],
    },
    contracts: [],
    prepaidEntitlements: [],
    inspectionHistory: [],
    projectedMileage: 51140,
    opportunities: [opportunity()],
    totals: { opportunityValue: 1100, customerOutOfPocket: 1100, coveredValue: 0 },
    alerts: [],
    ...over,
  }
}

describe('categorize', () => {
  it('recognises the everyday drive jobs', () => {
    expect(categorize(opportunity({ componentGroupKey: 'TIRES' })).category).toBe('TIRES')
    expect(categorize(opportunity({ componentGroupKey: 'BRAKE_PADS_SHOES' })).category).toBe('BRAKES')
    expect(categorize(opportunity({ componentGroupKey: 'WHEEL_ALIGNMENT' })).category).toBe('ALIGNMENT')
    expect(categorize(opportunity({ componentGroupKey: 'DENTS_DINGS' })).category).toBe('APPEARANCE')
    expect(categorize(opportunity({ componentGroupKey: 'OIL_CHANGE' })).category).toBe('FLUIDS')
    expect(categorize(opportunity({ componentGroupKey: 'BATTERY_12V' })).category).toBe('BATTERY')
  })

  it('lets a recall outrank its component group', () => {
    // A recall on a brake line is a recall conversation, not a brake sale.
    const recall = opportunity({ type: 'RECALL_OPEN', componentGroupKey: 'BRAKE_LINES' })
    expect(categorize(recall).category).toBe('RECALL')
  })

  it('treats product pitches as coverage, not as service work', () => {
    expect(categorize(opportunity({ type: 'CONTRACT_UPSELL' })).category).toBe('COVERAGE')
    expect(categorize(opportunity({ type: 'WARRANTY_EXPIRING' })).category).toBe('COVERAGE')
  })

  it('falls back rather than throwing on an unmapped group', () => {
    expect(categorize(opportunity({ componentGroupKey: 'SOMETHING_NEW' })).category).toBe('OTHER')
    expect(categorize(opportunity({ componentGroupKey: undefined })).category).toBe('OTHER')
  })
})

describe('recommendNext', () => {
  it('takes the top item still outstanding without re-ranking', () => {
    // The prep-sheet engine already ranked these. Re-ranking here would mean
    // two different orders inside one product.
    const list = [opportunity({ id: 'a' }), opportunity({ id: 'b' }), opportunity({ id: 'c' })]
    expect(recommendNext(list, {})?.opportunity.id).toBe('a')
    expect(recommendNext(list, { a: 'ACCEPTED' })?.opportunity.id).toBe('b')
    expect(recommendNext(list, { a: 'ACCEPTED', b: 'DECLINED' })?.opportunity.id).toBe('c')
  })

  it('treats a skipped item as done rather than looping back to it', () => {
    const list = [opportunity({ id: 'a' }), opportunity({ id: 'b' })]
    expect(recommendNext(list, { a: 'SKIPPED' })?.opportunity.id).toBe('b')
  })

  it('counts how many are still outstanding', () => {
    const list = [opportunity({ id: 'a' }), opportunity({ id: 'b' }), opportunity({ id: 'c' })]
    expect(recommendNext(list, { a: 'ACCEPTED' })?.remaining).toBe(2)
  })

  it('is null once everything is worked', () => {
    expect(recommendNext([opportunity({ id: 'a' })], { a: 'DECLINED' })).toBeNull()
    expect(recommendNext([], {})).toBeNull()
  })

  it('leads with safety over anything cheaper', () => {
    const safety = opportunity({ id: 'a', urgency: 'SAFETY' })
    expect(recommendNext([safety], {})?.reason).toContain('Safety')
  })

  it('calls out work the customer does not pay for', () => {
    const free = opportunity({ id: 'a', likelyPayer: 'PPM', customerOutOfPocket: 0 })
    expect(recommendNext([free], {})?.reason).toContain('nothing')
  })

  it('calls out a small share of a big ticket', () => {
    const mostly = opportunity({
      id: 'a', likelyPayer: 'VSC', estimatedAmount: 1000, customerOutOfPocket: 100,
    })
    expect(recommendNext([mostly], {})?.reason).toContain('Coverage carries')
  })
})

describe('buildHandoffLine', () => {
  it('maps the payer onto a DMS pay type', () => {
    expect(buildHandoffLine(opportunity({ likelyPayer: 'OEM_WARRANTY' }))).toContain('Pay type: W')
    expect(buildHandoffLine(opportunity({ likelyPayer: 'CUSTOMER_PAY' }))).toContain('Pay type: C')
  })

  it('flags covered work as needing confirmation before it starts', () => {
    const line = buildHandoffLine(
      opportunity({ likelyPayer: 'VSC', estimatedAmount: 1000, customerOutOfPocket: 100 }),
    )
    expect(line).toContain('Covered: $900')
    expect(line).toContain('confirm with administrator')
  })

  it('omits the covered line when the customer pays it all', () => {
    expect(buildHandoffLine(opportunity())).not.toContain('Covered:')
  })
})

describe('buildHandoffNote', () => {
  const asOf = new Date('2026-08-12T12:00:00Z')

  it('leads with the identity a DMS line needs', () => {
    const note = buildHandoffNote(sheet(), { o1: 'ACCEPTED' }, asOf)
    expect(note).toContain('Maria Perez — 2021 HYUNDAI Tucson')
    expect(note).toContain('5NP8BCFL4M04TB0CT')
    expect(note).toContain('51,140 mi')
  })

  it('does not stutter when the stored concern already says "customer states"', () => {
    // The seeded concerns and most DMS imports embed the phrase, and our label
    // adds it again. "Customer states: Customer states noise…" is exactly the
    // kind of thing that makes an advisor stop pasting and start retyping.
    const s = sheet({
      appointment: { ...sheet().appointment!, concerns: 'Customer states noise from front end over bumps' },
    })
    const note = buildHandoffNote(s, {}, asOf)
    expect(note).toContain('Customer states: noise from front end over bumps')
    expect(note).not.toContain('Customer states: Customer states')
  })

  it('separates approved from declined', () => {
    const s = sheet({
      opportunities: [
        opportunity({ id: 'o1' }),
        opportunity({ id: 'o2', title: 'Four Wheel Alignment', estimatedAmount: 149 }),
      ],
    })
    const note = buildHandoffNote(s, { o1: 'ACCEPTED', o2: 'DECLINED' }, asOf)
    expect(note).toContain('APPROVED')
    expect(note).toContain('DECLINED — logged for follow-up')
    expect(note.indexOf('APPROVED')).toBeLessThan(note.indexOf('DECLINED'))
  })

  it('says none rather than leaving an empty heading', () => {
    expect(buildHandoffNote(sheet(), {}, asOf)).toContain('(none)')
  })

  it('totals what the customer owes and what coverage carried', () => {
    const s = sheet({
      opportunities: [
        opportunity({ id: 'o1', estimatedAmount: 1000, customerOutOfPocket: 100, likelyPayer: 'VSC' }),
      ],
    })
    const note = buildHandoffNote(s, { o1: 'ACCEPTED' }, asOf)
    expect(note).toContain('Customer total: $100')
    expect(note).toContain('Covered by warranty/contract: $900')
  })

  it('carries the advisory disclaimer into the DMS', () => {
    // The note outlives this screen. Coverage that reads as promised in a DMS
    // comment is how a comeback starts.
    expect(buildHandoffNote(sheet(), { o1: 'ACCEPTED' }, asOf)).toContain('advisory')
  })

  it('emits no markdown — it is going into a plain comment field', () => {
    const note = buildHandoffNote(sheet(), { o1: 'ACCEPTED' }, asOf)
    expect(note).not.toContain('**')
    expect(note).not.toContain('##')
  })
})

describe('stripConcernPrefix', () => {
  it('removes the common prefixes advisors and DMS imports use', () => {
    expect(stripConcernPrefix('Customer states noise over bumps')).toBe('noise over bumps')
    expect(stripConcernPrefix('CUST STATES: pulling right')).toBe('pulling right')
    expect(stripConcernPrefix('C/S - vibration at speed')).toBe('vibration at speed')
  })

  it('leaves an ordinary concern alone', () => {
    expect(stripConcernPrefix('Noise from front end')).toBe('Noise from front end')
  })

  it('keeps the original when stripping would leave nothing', () => {
    expect(stripConcernPrefix('Customer states')).toBe('Customer states')
  })
})

describe('handoffCount', () => {
  it('counts only accepted items', () => {
    const list = [opportunity({ id: 'a' }), opportunity({ id: 'b' }), opportunity({ id: 'c' })]
    expect(handoffCount(list, { a: 'ACCEPTED', b: 'DECLINED', c: 'ACCEPTED' })).toBe(2)
  })
})
