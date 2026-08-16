import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv'
import { normaliseHeader, suggestMapping, summarise, validateRows } from './mapping'
import { ENTITIES, entityDef } from './entities'

/**
 * Column matching and row validation.
 *
 * The two properties under test: a manager should have almost nothing to map
 * by hand, and a file with some rubbish in it should still import the good
 * rows. Both are the difference between a store having history on day one and
 * giving up on a spreadsheet.
 */

const ASOF = new Date('2026-08-16T00:00:00.000Z')

describe('header normalisation', () => {
  it('ignores case, spaces and punctuation', () => {
    for (const h of ['ro_number', 'RO Number', 'ro-number', 'RoNumber', ' RO NUMBER ']) {
      expect(normaliseHeader(h), h).toBe('ronumber')
    }
  })

  it('does not invent characters that were not there', () => {
    // `RO #` is two letters once the punctuation goes, not "ronumber".
    // Normalisation strips; it never expands an abbreviation.
    expect(normaliseHeader('RO #')).toBe('ro')
  })

  it('still maps the abbreviated form, because the alias list carries it', () => {
    /*
      `RO #` is one of the most common headers a DMS exports, and it survives
      normalisation as `ro`. That is why `ro` is an alias in its own right —
      the matcher is exact, so every real-world spelling has to be listed
      rather than inferred.
    */
    const { mapping } = suggestMapping(
      ['VIN', 'Date', 'Description', 'RO #'],
      'SERVICE_HISTORY',
    )
    expect(mapping.roNumber).toBe('RO #')
  })
})

describe('guessing the mapping', () => {
  it('maps a typical declined-services export with nothing left over', () => {
    const headers = ['VIN', 'Customer Name', 'Op Description', 'Amount', 'Declined Date', 'Odometer']
    const { mapping, unmappedRequired } = suggestMapping(headers, 'DECLINED_SERVICE')

    expect(unmappedRequired).toEqual([])
    expect(mapping.vin).toBe('VIN')
    expect(mapping.description).toBe('Op Description')
    expect(mapping.quotedAmount).toBe('Amount')
    expect(mapping.declinedAt).toBe('Declined Date')
    expect(mapping.mileageAtDecline).toBe('Odometer')
    expect(mapping.customerName).toBe('Customer Name')
  })

  it('reports required fields it could not match', () => {
    const { unmappedRequired } = suggestMapping(['VIN', 'Notes'], 'DECLINED_SERVICE')
    const keys = unmappedRequired.map((f) => f.key).sort()
    expect(keys).toEqual(['declinedAt', 'description', 'quotedAmount'])
  })

  it('never maps one column to two fields', () => {
    // An export with both Mileage and Odometer should map one and offer the
    // other, not silently bind the same column twice.
    const headers = ['VIN', 'Description', 'Amount', 'Date', 'Mileage', 'Odometer']
    const { mapping, unusedHeaders } = suggestMapping(headers, 'DECLINED_SERVICE')
    const used = Object.values(mapping)
    expect(new Set(used).size).toBe(used.length)
    expect(unusedHeaders.length).toBe(1)
  })

  it('leaves an unrecognised column alone rather than guessing', () => {
    /*
      No fuzzy matching, deliberately. Mapping "Parts Amount" onto the quoted
      amount because the strings look similar imports twenty thousand wrong
      prices; leaving it blank is visible on the screen.
    */
    const { mapping, unusedHeaders } = suggestMapping(
      ['VIN', 'Description', 'Date', 'Parts Gross Profit Pct'],
      'DECLINED_SERVICE',
    )
    expect(mapping.quotedAmount).toBeUndefined()
    expect(unusedHeaders).toContain('Parts Gross Profit Pct')
  })

  it('has aliases for every required field on every entity', () => {
    // A required field with no aliases means every single import starts with
    // manual mapping, which is where imports get abandoned.
    for (const entity of ENTITIES) {
      for (const field of entity.fields.filter((f) => f.required)) {
        expect(field.aliases.length, `${entity.key}.${field.key}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('validating rows', () => {
  const headers = ['VIN', 'Op Description', 'Amount', 'Declined Date', 'Odometer']
  const mapping = suggestMapping(headers, 'DECLINED_SERVICE').mapping

  function run(body: string) {
    const csv = parseCsv(`${headers.join(',')}\n${body}`)
    return validateRows('DECLINED_SERVICE', mapping, csv.headers, csv.rows, ASOF)
  }

  it('imports a clean row with everything coerced', () => {
    const { rows, rejections } = run('5YJ3E1EA7JF005544,"Brake pads, front","$618.00",03/04/2024,84000')
    expect(rejections).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.fields.vin).toBe('5YJ3E1EA7JF005544')
    expect(rows[0]!.fields.description).toBe('Brake pads, front')
    expect(rows[0]!.fields.quotedAmount).toBe(618)
    expect(rows[0]!.fields.mileageAtDecline).toBe(84000)
    expect((rows[0]!.fields.declinedAt as Date).toISOString()).toBe('2024-03-04T00:00:00.000Z')
  })

  it('keeps the good rows when some are rubbish', () => {
    /*
      The property the whole importer rests on. Rejecting a file over forty bad
      rows loses the nineteen thousand good ones and the store gives up.
    */
    const { rows, rejections } = run([
      '5YJ3E1EA7JF005544,Brakes,618,03/04/2024,84000',
      'NOTAVIN,Brakes,618,03/04/2024,84000',
      '1HGCM82633A004352,Tires,1100,05/01/2024,91000',
    ].join('\n'))

    expect(rows).toHaveLength(2)
    expect(rejections).toHaveLength(1)
    expect(rejections[0]!.field).toBe('vin')
    expect(rejections[0]!.line).toBe(3)
  })

  it('rejects a row missing a required value', () => {
    const { rows, rejections } = run('5YJ3E1EA7JF005544,,618,03/04/2024,84000')
    expect(rows).toEqual([])
    expect(rejections[0]!.reason).toContain('required')
  })

  it('keeps a row whose optional field is unreadable, and says what it lost', () => {
    // Losing a $618 decline because its mileage column said "see notes" would
    // be the wrong trade. Losing the mileage is not.
    const { rows, rejections } = run('5YJ3E1EA7JF005544,Brakes,618,03/04/2024,see notes')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.fields.mileageAtDecline).toBeUndefined()
    expect(rejections[0]!.reason).toContain('imported without it')
  })

  it('stops at the first fault on a row rather than listing every one', () => {
    // A row with a mangled VIN usually has a mangled everything; six
    // rejections per row buries the rows with one real problem each.
    const { rejections } = run('NOTAVIN,,notmoney,notadate,notanumber')
    expect(rejections).toHaveLength(1)
  })

  it('refuses a decline dated in the future', () => {
    const { rows, rejections } = run('5YJ3E1EA7JF005544,Brakes,618,03/04/2099,84000')
    expect(rows).toEqual([])
    expect(rejections[0]!.reason).toContain('future')
  })

  it('treats the export placeholders as empty, not as text', () => {
    const { rows } = run('5YJ3E1EA7JF005544,Brakes,618,03/04/2024,N/A')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.fields.mileageAtDecline).toBeUndefined()
  })

  it('spots a column that is mapped but empty on every row', () => {
    // Almost always a mis-map, and invisible otherwise because nothing failed.
    const { alwaysEmpty } = run([
      '5YJ3E1EA7JF005544,Brakes,618,03/04/2024,',
      '1HGCM82633A004352,Tires,1100,05/01/2024,',
    ].join('\n'))
    expect(alwaysEmpty).toContain('Mileage at the time')
  })

  it('ignores columns that were never mapped', () => {
    const csv = parseCsv('VIN,Description,Amount,Date,Internal Cost Center\n5YJ3E1EA7JF005544,Brakes,618,03/04/2024,ZZ-9')
    const m = suggestMapping(csv.headers, 'DECLINED_SERVICE').mapping
    const { rows, rejections } = validateRows('DECLINED_SERVICE', m, csv.headers, csv.rows, ASOF)
    expect(rows).toHaveLength(1)
    expect(rejections).toEqual([])
  })
})

describe('the preview a manager decides from', () => {
  it('counts rows, not problems', () => {
    const headers = ['VIN', 'Description', 'Amount', 'Date']
    const mapping = suggestMapping(headers, 'DECLINED_SERVICE').mapping
    const csv = parseCsv([
      headers.join(','),
      '5YJ3E1EA7JF005544,Brakes,618,03/04/2024',
      'NOTAVIN,Brakes,618,03/04/2024',
      'ALSONOTAVIN,Brakes,618,03/04/2024',
    ].join('\n'))

    const result = validateRows('DECLINED_SERVICE', mapping, csv.headers, csv.rows, ASOF)
    const preview = summarise(result, csv.rows.length)

    expect(preview.totalRows).toBe(3)
    expect(preview.willImport).toBe(1)
    expect(preview.willReject).toBe(2)
  })

  it('does not count a row as rejected when only an optional field was dropped', () => {
    const headers = ['VIN', 'Description', 'Amount', 'Date', 'Odometer']
    const mapping = suggestMapping(headers, 'DECLINED_SERVICE').mapping
    const csv = parseCsv(`${headers.join(',')}\n5YJ3E1EA7JF005544,Brakes,618,03/04/2024,see notes`)

    const result = validateRows('DECLINED_SERVICE', mapping, csv.headers, csv.rows, ASOF)
    const preview = summarise(result, csv.rows.length)

    expect(preview.willImport).toBe(1)
    expect(preview.willReject).toBe(0)
  })
})

describe('entity definitions', () => {
  it('every entity has at least one required field, so nothing imports blindly', () => {
    for (const entity of ENTITIES) {
      expect(entity.fields.some((f) => f.required), entity.key).toBe(true)
    }
  })

  it('every entity is keyed by VIN, which is how rows find their vehicle', () => {
    for (const entity of ENTITIES) {
      const vin = entity.fields.find((f) => f.key === 'vin')
      expect(vin?.required, entity.key).toBe(true)
    }
  })

  it('field keys are unique within an entity', () => {
    for (const entity of ENTITIES) {
      const keys = entity.fields.map((f) => f.key)
      expect(new Set(keys).size, entity.key).toBe(keys.length)
    }
  })

  it('throws on an unknown entity rather than returning something empty', () => {
    // @ts-expect-error deliberately wrong, to prove it does not fail open.
    expect(() => entityDef('NOT_A_THING')).toThrow()
  })
})
