import { describe, expect, it } from 'vitest'
import { declineKey, nameParts } from './identity'

/**
 * Identity and deduplication.
 *
 * Two small functions carrying more consequence than their size suggests: one
 * decides whether re-running an import doubles a store's history, the other
 * decides whether their customer list is searchable.
 */

const VEHICLE = 'a1b2c3d4-0000-0000-0000-000000000000'

describe('the decline natural key', () => {
  it('matches the same decline written twice', () => {
    const a = declineKey(VEHICLE, new Date('2024-03-04T00:00:00Z'), 'Brake pads, front')
    const b = declineKey(VEHICLE, new Date('2024-03-04T00:00:00Z'), 'Brake pads, front')
    expect(a).toBe(b)
  })

  it('ignores the time of day', () => {
    /*
      Exports vary in whether they carry a time at all. Midnight versus 09:14
      on the same date is one decline, and treating them as two is how a
      re-import doubles a customer's menu.
    */
    const midnight = declineKey(VEHICLE, new Date('2024-03-04T00:00:00Z'), 'Brakes')
    const morning = declineKey(VEHICLE, new Date('2024-03-04T09:14:33Z'), 'Brakes')
    expect(midnight).toBe(morning)
  })

  it('ignores case and inconsistent whitespace in the description', () => {
    const a = declineKey(VEHICLE, new Date('2024-03-04'), 'Brake  pads,   FRONT')
    const b = declineKey(VEHICLE, new Date('2024-03-04'), 'brake pads, front')
    expect(a).toBe(b)
  })

  it('separates the same work on different vehicles', () => {
    const other = 'ffffffff-0000-0000-0000-000000000000'
    expect(declineKey(VEHICLE, new Date('2024-03-04'), 'Brakes'))
      .not.toBe(declineKey(other, new Date('2024-03-04'), 'Brakes'))
  })

  it('separates the same work declined on different days', () => {
    // Declined in March, quoted again and declined again in September, is two
    // declines — and the second is the one worth following up.
    expect(declineKey(VEHICLE, new Date('2024-03-04'), 'Brakes'))
      .not.toBe(declineKey(VEHICLE, new Date('2024-09-04'), 'Brakes'))
  })

  it('does not include the amount, so a re-quote is not a second decline', () => {
    /*
      The key deliberately omits price. A store re-exporting with updated
      pricing would otherwise insert a fresh copy of their entire history.
    */
    const key = declineKey(VEHICLE, new Date('2024-03-04'), 'Brakes')
    expect(key).not.toContain('618')
    expect(key).toBe(`${VEHICLE}|2024-03-04|brakes`)
  })
})

describe('splitting a name the way a DMS wrote it', () => {
  it('reads "SMITH, JOHN" surname first', () => {
    // Far more common in an export than "John Smith". Reading it backwards
    // files every customer under their first name.
    expect(nameParts('SMITH, JOHN')).toEqual({ firstName: 'JOHN', lastName: 'SMITH' })
  })

  it('reads "John Smith" surname last', () => {
    expect(nameParts('John Smith')).toEqual({ firstName: 'John', lastName: 'Smith' })
  })

  it('keeps a multi-word first name with the first name', () => {
    expect(nameParts('Mary Jane Watson')).toEqual({ firstName: 'Mary Jane', lastName: 'Watson' })
  })

  it('treats a lone word as a surname', () => {
    // The customer list sorts and searches on last name, and a single word in
    // a dealership's records is far more likely to be one.
    expect(nameParts('Rodriguez')).toEqual({ firstName: null, lastName: 'Rodriguez' })
  })

  it('never returns an empty surname, whatever it is handed', () => {
    // lastName is what the roster is ordered by; blank would sort a customer
    // to the top of the list forever.
    for (const input of ['', '   ', ',', ' , ']) {
      expect(nameParts(input).lastName, JSON.stringify(input)).not.toBe('')
    }
  })

  it('handles a trailing comma with nothing after it', () => {
    expect(nameParts('SMITH,')).toEqual({ firstName: null, lastName: 'SMITH' })
  })

  it('collapses runaway whitespace', () => {
    expect(nameParts('  John    Smith  ')).toEqual({ firstName: 'John', lastName: 'Smith' })
  })
})
