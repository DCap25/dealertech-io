import { describe, expect, it } from 'vitest'
import {
  describeReceipt, idempotencyKey, provenanceNote, withProvenance,
  type HandOffReceipt,
} from './handoff-record'
import type { HandOffLine, HandOffPayload } from './types'

function line(over: Partial<HandOffLine> = {}): HandOffLine {
  return {
    title: 'Front brake pads & rotors',
    concern: 'Measured at 3mm',
    componentGroupKey: 'BRAKE_PADS_SHOES',
    recommendedPayType: 'CUSTOMER_PAY',
    estimatedAmount: 618,
    customerOutOfPocket: 618,
    coveredAmount: 0,
    coverageNote: null,
    ...over,
  }
}

function payload(over: Partial<HandOffPayload> = {}): HandOffPayload {
  return {
    appointmentId: 'appt-1',
    repairOrderId: null,
    customerId: 'cust-1',
    vehicleId: 'veh-1',
    mileage: 29_517,
    accepted: [line()],
    declined: [],
    deferred: [],
    authorization: null,
    note: 'whatever',
    createdAt: new Date('2026-08-12T08:14:00'),
    ...over,
  }
}

describe('idempotencyKey', () => {
  it('is the same for the same content pushed twice', () => {
    // A double-tap, a retry after a timeout, or a reload then another push
    // must not create a second repair order.
    expect(idempotencyKey(payload())).toBe(idempotencyKey(payload()))
  })

  it('ignores when the push happened', () => {
    const early = payload({ createdAt: new Date('2026-08-12T08:00:00') })
    const late = payload({ createdAt: new Date('2026-08-12T17:00:00') })
    expect(idempotencyKey(early)).toBe(idempotencyKey(late))
  })

  it('ignores the note, which is derived rather than decided', () => {
    expect(idempotencyKey(payload({ note: 'one' }))).toBe(idempotencyKey(payload({ note: 'two' })))
  })

  it('ignores the order lines happen to be in', () => {
    // Reordering the menu is not a different hand-off.
    const a = payload({ accepted: [line({ title: 'A' }), line({ title: 'B' })] })
    const b = payload({ accepted: [line({ title: 'B' }), line({ title: 'A' })] })
    expect(idempotencyKey(a)).toBe(idempotencyKey(b))
  })

  it('changes when a line is added', () => {
    const one = payload()
    const two = payload({ accepted: [line(), line({ title: 'Four wheel alignment' })] })
    expect(idempotencyKey(one)).not.toBe(idempotencyKey(two))
  })

  it('changes when the price changes', () => {
    // Re-quoting after teardown is a genuinely different hand-off.
    const before = payload()
    const after = payload({ accepted: [line({ estimatedAmount: 940 })] })
    expect(idempotencyKey(before)).not.toBe(idempotencyKey(after))
  })

  it('changes when a line moves from accepted to declined', () => {
    const accepted = payload({ accepted: [line()], declined: [] })
    const declined = payload({ accepted: [], declined: [line()] })
    expect(idempotencyKey(accepted)).not.toBe(idempotencyKey(declined))
  })

  it('separates two visits by the same customer', () => {
    const first = payload({ appointmentId: 'appt-1' })
    const second = payload({ appointmentId: 'appt-2' })
    expect(idempotencyKey(first)).not.toBe(idempotencyKey(second))
  })
})

describe('provenanceNote', () => {
  it('says nothing when the advisor recorded everything', () => {
    expect(provenanceNote({ a: 'ADVISOR', b: 'ADVISOR' }, ['a', 'b'])).toBeNull()
  })

  it('says so when the customer chose everything themselves', () => {
    const note = provenanceNote({ a: 'CUSTOMER', b: 'CUSTOMER' }, ['a', 'b'], 'Lane 3')
    expect(note).toBe('All approvals selected by the customer on Lane 3.')
  })

  it('counts a mixed visit', () => {
    const note = provenanceNote({ a: 'CUSTOMER', b: 'ADVISOR' }, ['a', 'b'], 'Lane 3')
    expect(note).toMatch(/1 of 2 approvals selected by the customer on Lane 3/)
    expect(note).toMatch(/the rest recorded by the advisor/)
  })

  it('works without a device name', () => {
    expect(provenanceNote({ a: 'CUSTOMER' }, ['a'])).toBe(
      'All approvals selected by the customer.',
    )
  })
})

describe('withProvenance', () => {
  it('appends to the note that lands in the DMS comment field', () => {
    expect(withProvenance('APPROVED\n  Brakes', 'All approvals selected by the customer.')).toBe(
      'APPROVED\n  Brakes\n\nAll approvals selected by the customer.',
    )
  })

  it('leaves the note alone when there is nothing to add', () => {
    expect(withProvenance('APPROVED', null)).toBe('APPROVED')
  })
})

describe('describeReceipt', () => {
  const base: HandOffReceipt = {
    id: 'h1',
    status: 'SENT',
    vendor: 'Mock',
    persisted: false,
    externalRef: 'mock-handoff-3',
    message: 'ok',
    acceptedCount: 2,
    attempts: 1,
    sentAt: new Date('2026-08-12T08:14:00'),
    createdAt: new Date('2026-08-12T08:14:00'),
  }

  it('refuses to claim a real write the adapter did not make', () => {
    // A mock that reads as "sent to the DMS" is how a demo becomes a false
    // promise in a pilot.
    expect(describeReceipt(base)).toMatch(/not a real DMS write/)
  })

  it('says sent plainly when the write was persisted', () => {
    const real = describeReceipt({ ...base, persisted: true, vendor: 'CDK Global' })
    expect(real).toMatch(/Sent to CDK Global/)
    expect(real).not.toMatch(/not a real/)
  })

  it('counts attempts on a failure', () => {
    expect(describeReceipt({ ...base, status: 'FAILED', attempts: 3 })).toBe(
      'Not sent after 3 attempts.',
    )
    expect(describeReceipt({ ...base, status: 'FAILED', attempts: 1 })).toBe('Not sent.')
  })
})
