import { describe, expect, it } from 'vitest'
import {
  coerceDate, coerceEmail, coerceMileage, coerceMoney, coercePhone, coerceText,
  coerceVin, isBlank,
} from './coerce'

/**
 * Value coercion.
 *
 * The bias under test is that refusing beats guessing. An import runs once,
 * unattended, and a silently mis-parsed value becomes a number an advisor
 * quotes to a customer eighteen months later with no way to trace it.
 */

const ASOF = new Date('2026-08-16T00:00:00.000Z')

describe('blanks', () => {
  it('recognises the placeholders exports use for nothing', () => {
    for (const v of ['', '   ', 'N/A', 'na', 'NULL', 'none', '-', '--', 'Unknown']) {
      expect(isBlank(v), v).toBe(true)
    }
  })

  it('does not treat a zero or a real value as blank', () => {
    expect(isBlank('0')).toBe(false)
    expect(isBlank('Brakes')).toBe(false)
  })
})

describe('VIN', () => {
  it('accepts a real one and uppercases it', () => {
    const r = coerceVin(' 5yj3e1ea7jf005544 ')
    expect(r.ok && r.value).toBe('5YJ3E1EA7JF005544')
  })

  it('refuses the wrong length rather than padding or truncating', () => {
    // A short VIN silently creates a phantom vehicle that shares nothing with
    // the real one — declines land on a car that never visits.
    const r = coerceVin('1HGCM82633A')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('11 characters')
  })

  it('refuses I, O and Q, which a VIN never contains', () => {
    // Excluded from the alphabet precisely so they cannot be confused with
    // 1 and 0 — so one appearing is a transcription error, not a rare vehicle.
    const r = coerceVin('1HGCM82633A0O4352')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('I, O or Q')
  })

  it('refuses punctuation', () => {
    expect(coerceVin('1HGCM82633A-04352').ok).toBe(false)
  })
})

describe('dates', () => {
  it('reads ISO', () => {
    const r = coerceDate('2024-03-04')
    expect(r.ok && r.value.toISOString()).toBe('2024-03-04T00:00:00.000Z')
  })

  it('reads US order for an ambiguous slash date', () => {
    // 03/04 is March 4th here, because the product serves US dealerships and
    // their systems export month-first.
    const r = coerceDate('03/04/2024')
    expect(r.ok && r.value.getUTCMonth()).toBe(2)
    expect(r.ok && r.value.getUTCDate()).toBe(4)
  })

  it('reads day-first when only one reading is possible', () => {
    // 25/12 cannot be a month, so there is nothing to guess at.
    const r = coerceDate('25/12/2023')
    expect(r.ok && r.value.getUTCMonth()).toBe(11)
    expect(r.ok && r.value.getUTCDate()).toBe(25)
  })

  it('expands two-digit years into the right century', () => {
    // Getting this wrong by a hundred years would make every warranty expired.
    const nineties = coerceDate('03/04/98')
    const twenties = coerceDate('03/04/24')
    expect(nineties.ok && nineties.value.getUTCFullYear()).toBe(1998)
    expect(twenties.ok && twenties.value.getUTCFullYear()).toBe(2024)
  })

  it('builds dates in UTC so an import does not shift by a day', () => {
    const r = coerceDate('2024-01-01')
    expect(r.ok && r.value.getUTCDate()).toBe(1)
  })

  it('refuses a date that does not exist', () => {
    expect(coerceDate('2023-02-30').ok).toBe(false)
    expect(coerceDate('13/45/2024').ok).toBe(false)
  })

  it('refuses a future date where one makes no sense', () => {
    // A decline dated next year sorts to the top of every follow-up list
    // forever.
    const r = coerceDate('2027-01-01', { notFuture: true, asOf: ASOF })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('future')
  })

  it('allows a future date where one is legitimate', () => {
    expect(coerceDate('2027-01-01', { asOf: ASOF }).ok).toBe(true)
  })

  it('refuses free text rather than reaching for Date.parse', () => {
    // `new Date("next tuesday")` and friends are exactly how a garbage cell
    // becomes a plausible-looking wrong date.
    expect(coerceDate('last March').ok).toBe(false)
    expect(coerceDate('42').ok).toBe(false)
  })
})

describe('money', () => {
  it('reads the shapes exports write', () => {
    for (const [raw, expected] of [['$1,234.56', 1234.56], ['618', 618], [' 84.00 ', 84]] as const) {
      const r = coerceMoney(raw)
      expect(r.ok && r.value, raw).toBe(expected)
    }
  })

  it('rounds to cents so a float artefact never reaches an invoice', () => {
    const r = coerceMoney('0.1')
    expect(r.ok && r.value).toBe(0.1)
  })

  it('refuses a negative, however it is written', () => {
    // A decline worth minus six hundred dollars is a credit or a sign
    // convention we do not understand. Either way it must not reach a menu.
    expect(coerceMoney('-618').ok).toBe(false)
    expect(coerceMoney('(618.00)').ok).toBe(false)
  })

  it('refuses an implausibly large amount and names the likely cause', () => {
    const r = coerceMoney('61800000')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('cents')
  })

  it('refuses text', () => {
    expect(coerceMoney('n/a').ok).toBe(false)
    expect(coerceMoney('$$$').ok).toBe(false)
  })
})

describe('mileage', () => {
  it('reads a number with separators', () => {
    const r = coerceMileage('84,000')
    expect(r.ok && r.value).toBe(84000)
  })

  it('accepts zero, which a new vehicle genuinely has', () => {
    const r = coerceMileage('0')
    expect(r.ok && r.value).toBe(0)
  })

  it('refuses a decimal rather than rounding silently', () => {
    expect(coerceMileage('84000.5').ok).toBe(false)
  })

  it('refuses something absurd and names the likely cause', () => {
    // Past a million it is a VIN in the mileage column or a figure in tenths,
    // and either wrecks every interval calculation for that vehicle.
    const r = coerceMileage('5400000')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('tenths')
  })

  it('refuses a negative', () => {
    expect(coerceMileage('-5').ok).toBe(false)
  })
})

describe('contact details', () => {
  it('lowercases an email so the same customer matches across exports', () => {
    const r = coerceEmail(' Dan.Caplan@Example.COM ')
    expect(r.ok && r.value).toBe('dan.caplan@example.com')
  })

  it('refuses something that is not an address', () => {
    expect(coerceEmail('dan at example').ok).toBe(false)
    expect(coerceEmail('dan@localhost').ok).toBe(false)
  })

  it('reduces a phone number to its ten digits', () => {
    for (const v of ['(512) 555-0134', '512-555-0134', '+1 512 555 0134', '15125550134']) {
      const r = coercePhone(v)
      expect(r.ok && r.value, v).toBe('5125550134')
    }
  })

  it('refuses a number of the wrong length rather than padding it', () => {
    expect(coercePhone('555-0134').ok).toBe(false)
  })
})

describe('text', () => {
  it('trims but keeps the value', () => {
    const r = coerceText('  Brake pads, front  ')
    expect(r.ok && r.value).toBe('Brake pads, front')
  })

  it('refuses an empty description', () => {
    expect(coerceText('   ').ok).toBe(false)
  })

  it('truncates an over-long value rather than losing the row', () => {
    const r = coerceText('x'.repeat(900), 500)
    expect(r.ok && r.value.length).toBe(500)
  })
})
