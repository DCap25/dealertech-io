import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv'
import { suggestMapping, summarise, validateRows } from './mapping'

/**
 * The whole pipeline, against a file shaped like a real export.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS ALONGSIDE THE UNIT TESTS
 * ---------------------------------------------------------------------------
 * Every stage is tested on its own, and every stage passing says nothing about
 * whether they compose. The import wizard runs exactly this sequence —
 * parse, suggest, validate, summarise — in the browser, and the numbers it
 * shows a manager come out of the end of it.
 *
 * The fixture below is deliberately unpleasant in the specific ways a DMS
 * export is unpleasant: surname-first names, a quoted comma in a description,
 * a transposed VIN, a date typed in the wrong decade, a mileage cell somebody
 * typed a note into, and the same vehicle appearing several times. Every one
 * of those is a thing that has to survive contact with the whole chain rather
 * than with one function.
 */

const ASOF = new Date('2026-08-16T00:00:00.000Z')

/*
  Note the VINs. `5YJ3E1EA7JF005544` and `1HGCM82633A004352` are valid,
  including their ISO 3779 check digits. `5YJ3E1EA7JF005454` is the first one
  with two characters transposed — the case a length-and-alphabet check waves
  through and the check digit catches, and the one that silently creates a
  phantom vehicle whose history never matches the real car.
*/
const EXPORT = [
  'VIN,Customer Name,Op Description,Amount,Declined Date,Odometer,Reason,Year,Make,Model',
  '5YJ3E1EA7JF005544,"SMITH, JOHN","Brake pads, front","$618.00",03/04/2024,84000,Cost,2018,TESLA,Model 3',
  '1HGCM82633A004352,"DOE, JANE",Four wheel alignment,149.00,05/12/2024,91250,No time,2003,HONDA,Accord',
  '5YJ3E1EA7JF005544,"SMITH, JOHN",Cabin air filter,97.00,03/04/2024,84000,,2018,TESLA,Model 3',
  'NOTAVALIDVIN12345,"BAD, ROW",Tires,1100.00,01/02/2024,50000,,2020,FORD,F-150',
  '1HGCM82633A004352,"DOE, JANE","Transmission service, full",367.50,07/01/2024,95000,Deferred,2003,HONDA,Accord',
  '5YJ3E1EA7JF005454,"TRANSPOSED, VIN",Wipers,62.00,02/02/2024,10000,,2018,TESLA,Model 3',
  '1HGCM82633A004352,"DOE, JANE",Coolant flush,250.00,12/25/2099,96000,Future date,2003,HONDA,Accord',
  '5YJ3E1EA7JF005544,"SMITH, JOHN",Spark plugs,535.00,08/08/2024,see notes,,2018,TESLA,Model 3',
].join('\n')

function run() {
  const parsed = parseCsv(EXPORT)
  const { mapping, unmappedRequired } = suggestMapping(parsed.headers, 'DECLINED_SERVICE')
  const validated = validateRows('DECLINED_SERVICE', mapping, parsed.headers, parsed.rows, ASOF)
  return { parsed, mapping, unmappedRequired, validated, preview: summarise(validated, parsed.rows.length) }
}

describe('a realistic export, end to end', () => {
  it('reads every row and finds no structural problems', () => {
    const { parsed } = run()
    expect(parsed.rows).toHaveLength(8)
    expect(parsed.problems).toEqual([])
  })

  it('maps every required column without anybody touching a dropdown', () => {
    // The mapping screen is where imports get abandoned. A typical export
    // should need confirming, not filling in.
    const { unmappedRequired, mapping } = run()
    expect(unmappedRequired).toEqual([])
    expect(mapping.vin).toBe('VIN')
    expect(mapping.description).toBe('Op Description')
    expect(mapping.quotedAmount).toBe('Amount')
    expect(mapping.declinedAt).toBe('Declined Date')
  })

  it('imports the five good rows and drops exactly the three bad ones', () => {
    const { preview } = run()
    expect(preview.totalRows).toBe(8)
    expect(preview.willImport).toBe(5)
    expect(preview.willReject).toBe(3)
  })

  it('drops the malformed VIN, the transposed VIN, and the future date — and nothing else', () => {
    const { validated } = run()
    const fatal = validated.rejections.filter((r) => !r.reason.includes('imported without it'))
    expect(fatal.map((r) => r.line).sort()).toEqual([5, 7, 8])

    const byLine = new Map(fatal.map((r) => [r.line, r.reason]))
    /*
      `NOTAVALIDVIN12345` is 17 characters, so it is caught by the letters
      rather than the length — I and O are excluded from the VIN alphabet
      precisely so they cannot be confused with 1 and 0, which makes their
      presence a transcription error rather than an unusual vehicle.
    */
    expect(byLine.get(5)).toContain('I, O or Q')
    expect(byLine.get(7)).toContain('check digit')   // transposed
    expect(byLine.get(8)).toContain('future')        // 2099
  })

  it('phrases a rejection as a sentence a service manager can act on', () => {
    // The label and the reason are composed, so the message reads "VIN
    // contains I, O or Q…" rather than "vin: INVALID_CHARS". This is the
    // whole argument for hand-writing the parser.
    const { validated } = run()
    const vinFault = validated.rejections.find((r) => r.line === 5)!
    expect(vinFault.reason.startsWith('VIN contains')).toBe(true)
    expect(vinFault.value).toBe('NOTAVALIDVIN12345')
  })

  it('keeps the row whose mileage cell says "see notes", minus the mileage', () => {
    /*
      The trade this importer is built around. Losing a $535 spark plug
      decline because somebody typed a note in the odometer column would be
      the wrong answer; losing the odometer is not.
    */
    const { validated } = run()
    const sparkPlugs = validated.rows.find((r) => r.fields.description === 'Spark plugs')
    expect(sparkPlugs).toBeDefined()
    expect(sparkPlugs!.fields.mileageAtDecline).toBeUndefined()
    expect(sparkPlugs!.fields.quotedAmount).toBe(535)
  })

  it('keeps the comma inside a quoted description intact', () => {
    const { validated } = run()
    const descriptions = validated.rows.map((r) => r.fields.description)
    expect(descriptions).toContain('Brake pads, front')
    expect(descriptions).toContain('Transmission service, full')
  })

  it('reads the money, the dates and the odometer as values rather than strings', () => {
    const { validated } = run()
    const brakes = validated.rows.find((r) => r.fields.description === 'Brake pads, front')!
    expect(brakes.fields.quotedAmount).toBe(618)
    expect(brakes.fields.mileageAtDecline).toBe(84000)
    expect((brakes.fields.declinedAt as Date).toISOString()).toBe('2024-03-04T00:00:00.000Z')
  })

  it('carries the vehicle identity through, so an unknown VIN can be created', () => {
    const { validated } = run()
    const row = validated.rows[0]!
    expect(row.fields.make).toBe('TESLA')
    expect(row.fields.modelYear).toBe(2018)
    expect(row.fields.model).toBe('Model 3')
  })

  it('does not report a mapped column as always-empty when it has values', () => {
    const { validated } = run()
    expect(validated.alwaysEmpty).toEqual([])
  })

  it('gives a manager a rejection list short enough to act on', () => {
    // Three distinct reasons, not eight rows of noise — the difference
    // between one fix in a spreadsheet and an afternoon.
    const { preview } = run()
    const reasons = new Set(preview.sampleRejections.map((r) => r.reason))
    expect(reasons.size).toBeLessThanOrEqual(4)
  })
})
