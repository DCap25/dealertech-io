import { describe, expect, it } from 'vitest'
import { MAX_ROWS, parseCsv, toRecord } from './csv'

/**
 * The CSV parser.
 *
 * Tested against the shapes a real DMS export actually arrives in rather than
 * against tidy examples: byte-order marks, commas inside descriptions,
 * newlines inside addresses, Windows line endings, and rows missing a column.
 * Every one of these has cost somebody an afternoon somewhere.
 */

describe('the basics', () => {
  it('reads a header and rows', () => {
    const { headers, rows, problems } = parseCsv('vin,mileage\n1HGCM,84000\n5YJ3E,12000')
    expect(headers).toEqual(['vin', 'mileage'])
    expect(rows.map((r) => r.values)).toEqual([['1HGCM', '84000'], ['5YJ3E', '12000']])
    expect(problems).toEqual([])
  })

  it('handles a file with no trailing newline, and one with', () => {
    expect(parseCsv('a,b\n1,2').rows).toHaveLength(1)
    expect(parseCsv('a,b\n1,2\n').rows).toHaveLength(1)
  })

  it('ignores blank lines rather than importing them as rows', () => {
    // Exports scatter these, and a blank row would become a customer with no name.
    const { rows } = parseCsv('a,b\n1,2\n\n3,4\n\n')
    expect(rows.map((r) => r.values)).toEqual([['1', '2'], ['3', '4']])
  })

  it('returns nothing useful for an empty file without throwing', () => {
    expect(() => parseCsv('')).not.toThrow()
    expect(parseCsv('').headers).toEqual([])
    expect(parseCsv('').rows).toEqual([])
  })
})

describe('the things that break naive parsers', () => {
  it('keeps a comma inside a quoted description', () => {
    // "brake pads, front" is not two columns. This is the single most common
    // way a hand-rolled split() destroys a file.
    const { rows } = parseCsv('desc,amount\n"Brake pads, front",618.00')
    expect(rows[0]!.values).toEqual(['Brake pads, front', '618.00'])
  })

  it('keeps a newline inside a quoted value', () => {
    const { rows } = parseCsv('name,address\nDan,"12 Main St\nAustin, TX"')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.values[1]).toBe('12 Main St\nAustin, TX')
  })

  it('unescapes a doubled quote', () => {
    const { rows } = parseCsv('desc\n"He said ""no"" today"')
    expect(rows[0]!.values[0]).toBe('He said "no" today')
  })

  it('treats a stray quote mid-value as data, not syntax', () => {
    /*
      `20" wheel` unquoted. Reading that " as the start of a quoted field
      would swallow the remainder of the file into one enormous cell — the
      failure mode where a 20,000-row import silently becomes one row.
    */
    const { rows, problems } = parseCsv('desc,amount\n20" wheel,199')
    expect(rows[0]!.values).toEqual(['20" wheel', '199'])
    expect(problems).toEqual([])
  })

  it('strips a byte-order mark from the first header', () => {
    // Left in place it becomes part of the header name, and the mapping then
    // fails to match a column that looks perfectly correct on screen.
    const { headers } = parseCsv('﻿vin,mileage\n1HGCM,84000')
    expect(headers[0]).toBe('vin')
  })

  it('reads Windows line endings', () => {
    const { headers, rows } = parseCsv('a,b\r\n1,2\r\n3,4\r\n')
    expect(headers).toEqual(['a', 'b'])
    expect(rows.map((r) => r.values)).toEqual([['1', '2'], ['3', '4']])
  })

  it('reads old-Mac lone carriage returns', () => {
    const { rows } = parseCsv('a,b\r1,2\r3,4')
    expect(rows.map((r) => r.values)).toEqual([['1', '2'], ['3', '4']])
  })

  it('keeps an empty value distinct from a missing one', () => {
    const { rows } = parseCsv('a,b,c\n1,,3')
    expect(rows[0]!.values).toEqual(['1', '', '3'])
  })

  it('trims header names but never values', () => {
    // A description with meaningful leading space is rare; a header exported
    // as " vin " is not, and it would fail to match the mapping.
    const { headers, rows } = parseCsv(' vin , mileage \n  1HGCM  ,84000')
    expect(headers).toEqual(['vin', 'mileage'])
    expect(rows[0]!.values[0]).toBe('  1HGCM  ')
  })
})

describe('rows whose shape disagrees with the header', () => {
  it('pads a short row and says so, rather than discarding it', () => {
    /*
      Deliberate. A short row is usually trailing empty columns the export
      omitted, and throwing away a $1,400 decline because its optional reason
      field was absent would be the wrong trade.
    */
    const { rows, problems } = parseCsv('a,b,c\n1,2')
    expect(rows[0]!.values).toEqual(['1', '2', ''])
    expect(problems[0]!.kind).toBe('TOO_FEW_COLUMNS')
    expect(problems[0]!.line).toBe(2)
  })

  it('drops extra values and points at the likely cause', () => {
    const { rows, problems } = parseCsv('a,b\n1,2,3')
    expect(rows[0]!.values).toEqual(['1', '2'])
    expect(problems[0]!.kind).toBe('TOO_MANY_COLUMNS')
    expect(problems[0]!.detail).toContain('unquoted comma')
  })

  it('reports an unclosed quote against the line it started on', () => {
    const { problems } = parseCsv('a,b\n1,"never closed')
    expect(problems.some((p) => p.kind === 'UNCLOSED_QUOTE')).toBe(true)
  })
})

describe('line numbers, because they are the whole point', () => {
  it('counts physical lines so they match what a spreadsheet shows', () => {
    const { rows } = parseCsv('a\n1\n2\n3')
    expect(rows.map((r) => r.line)).toEqual([2, 3, 4])
  })

  it('keeps counting correctly across a value containing newlines', () => {
    // The row after a multi-line value must still report the line a human
    // would scroll to, or every subsequent error points at the wrong place.
    const { rows } = parseCsv('a,b\nx,"one\ntwo\nthree"\ny,z')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.line).toBe(2)
    expect(rows[1]!.line).toBe(5)
  })

  it('reports blank lines without consuming a row number', () => {
    const { rows } = parseCsv('a\n1\n\n2')
    expect(rows.map((r) => r.line)).toEqual([2, 4])
  })
})

describe('headers that cannot be mapped', () => {
  it('flags an unnamed column', () => {
    const { problems } = parseCsv('vin,,mileage\n1,2,3')
    expect(problems.some((p) => p.kind === 'EMPTY_HEADER')).toBe(true)
  })

  it('flags a duplicated column name as ambiguous', () => {
    const { problems } = parseCsv('vin,mileage,vin\n1,2,3')
    const dup = problems.find((p) => p.kind === 'DUPLICATE_HEADER')
    expect(dup).toBeDefined()
    expect(dup!.detail).toContain('ambiguous')
  })
})

describe('protection against a file that is not what somebody thinks', () => {
  it('stops at the row cap and says it did', () => {
    // Hitting this usually means the whole group was exported instead of one
    // rooftop — worth saying out loud rather than absorbing silently.
    const big = 'a\n' + '1\n'.repeat(MAX_ROWS + 10)
    const { rows, truncated } = parseCsv(big)
    expect(rows).toHaveLength(MAX_ROWS)
    expect(truncated).toBe(true)
  })

  it('does not claim truncation on a file that fits', () => {
    expect(parseCsv('a\n1\n2').truncated).toBe(false)
  })
})

describe('toRecord', () => {
  it('keys values by header name', () => {
    const { headers, rows } = parseCsv('vin,mileage\n1HGCM,84000')
    expect(toRecord(headers, rows[0]!)).toEqual({ vin: '1HGCM', mileage: '84000' })
  })

  it('omits unnamed columns rather than inventing an empty key', () => {
    const { headers, rows } = parseCsv('vin,,mileage\n1HGCM,junk,84000')
    expect(toRecord(headers, rows[0]!)).toEqual({ vin: '1HGCM', mileage: '84000' })
  })
})
