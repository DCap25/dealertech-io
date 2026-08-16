/**
 * Reading a dealership's export.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS HAND-WRITTEN AND NOT A DEPENDENCY
 * ---------------------------------------------------------------------------
 * Not because CSV is easy — it is famously not. Because of what the errors
 * have to say.
 *
 * The file arriving here was exported by somebody's DMS at eleven at night and
 * emailed over. It will have a byte-order mark, quoted descriptions containing
 * commas, an address field with a newline inside it, and three rows near the
 * end where a column is missing entirely. A parser that throws "Invalid CSV"
 * on row 4,112 of 20,000 is useless: the person holding this file cannot read
 * the code, and telling them their export is broken without saying *where*
 * means the import never happens and the pilot dies of a spreadsheet.
 *
 * So this reports position for everything, recovers from bad rows instead of
 * abandoning the file, and is small enough to read in one sitting. It is also
 * one fewer dependency in a repo that has kept them to ten.
 *
 * Strictly RFC 4180 with the concessions real exports require: CRLF or LF,
 * a leading BOM, and a trailing newline.
 *
 * Pure and I/O-free. Feeds src/lib/import/mapping.ts.
 */

/** A cell that could not be read, or a row whose shape disagreed with the header. */
export interface CsvProblem {
  /** 1-based, and counting physical lines — which is what a spreadsheet shows. */
  line: number
  kind: 'UNCLOSED_QUOTE' | 'TOO_FEW_COLUMNS' | 'TOO_MANY_COLUMNS' | 'EMPTY_HEADER' | 'DUPLICATE_HEADER'
  detail: string
}

export interface CsvRow {
  /** Aligned to `headers` by position. Short rows are padded with ''. */
  values: string[]
  /** Physical line the record started on, for pointing somebody at a cell. */
  line: number
}

export interface CsvParseResult {
  headers: string[]
  rows: CsvRow[]
  problems: CsvProblem[]
  /** True when the row cap was hit and parsing stopped early. */
  truncated: boolean
}

/**
 * A ceiling, so one bad file cannot take the process down.
 *
 * Generous: a franchise store's five years of declined services is tens of
 * thousands of rows, not hundreds of thousands. Hitting this is a signal that
 * somebody exported the whole group rather than one rooftop, which is worth
 * saying out loud rather than absorbing silently.
 */
export const MAX_ROWS = 200_000

/**
 * Split raw text into records of fields.
 *
 * A character-at-a-time state machine rather than a regex or a `split`.
 * Splitting on commas breaks the first time a technician writes "brake pads,
 * front" in a description, and that is not an edge case — it is Tuesday.
 */
function tokenize(text: string): { records: string[][]; lines: number[]; problems: CsvProblem[] } {
  const records: string[][] = []
  const lines: number[] = []
  const problems: CsvProblem[] = []

  let field = ''
  let record: string[] = []
  let inQuotes = false
  let line = 1
  let recordStartLine = 1
  let sawAnyChar = false

  const endField = () => {
    record.push(field)
    field = ''
  }

  const endRecord = () => {
    endField()
    // A record of one empty field is a blank line, not a row of data. Real
    // exports end with one, and some have them scattered throughout.
    const isBlank = record.length === 1 && record[0] === ''
    if (!isBlank) {
      records.push(record)
      lines.push(recordStartLine)
    }
    record = []
    recordStartLine = line
    sawAnyChar = false
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!

    if (!sawAnyChar && char !== '\r' && char !== '\n') {
      recordStartLine = line
      sawAnyChar = true
    }

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        if (char === '\n') line++
        field += char
      }
      continue
    }

    if (char === '"') {
      /*
        Only opens a quoted field at the start of one. A stray quote mid-field
        — `12" wheel` unquoted — is data, not syntax, and treating it as an
        opening quote would swallow the rest of the file.
      */
      if (field === '') inQuotes = true
      else field += char
      continue
    }

    if (char === ',') { endField(); continue }

    if (char === '\r') {
      // CRLF: let the \n do the work. A lone \r is an old-Mac line ending.
      if (text[i + 1] === '\n') continue
      line++
      endRecord()
      continue
    }

    if (char === '\n') { line++; endRecord(); continue }

    field += char
  }

  // Whatever is left when the text runs out is a final record without a
  // trailing newline, which is legal and common.
  if (inQuotes) {
    problems.push({
      line: recordStartLine,
      kind: 'UNCLOSED_QUOTE',
      detail: 'A quoted value is never closed. The rest of the file was read as part of it — check for a stray " on this line.',
    })
  }
  if (field !== '' || record.length > 0) endRecord()

  return { records, lines, problems }
}

/**
 * Parse a dealership export.
 *
 * Never throws. A file this cannot read produces problems and whatever rows it
 * could recover, because a partial import somebody can see the gaps in beats a
 * stack trace they cannot act on.
 */
export function parseCsv(text: string): CsvParseResult {
  // Excel writes a BOM. Left in place it becomes part of the first header
  // name, and the column mapping then fails to match a header that looks
  // correct on screen — an hour lost to an invisible character.
  const cleaned = text.replace(/^﻿/, '')

  const { records, lines, problems } = tokenize(cleaned)

  if (records.length === 0) {
    return { headers: [], rows: [], problems, truncated: false }
  }

  const rawHeaders = records[0]!.map((h) => h.trim())
  const headers: string[] = []
  const seen = new Map<string, number>()

  rawHeaders.forEach((header, index) => {
    if (header === '') {
      problems.push({
        line: lines[0] ?? 1,
        kind: 'EMPTY_HEADER',
        detail: `Column ${index + 1} has no name. It cannot be mapped to a field and will be ignored.`,
      })
    }
    const previous = seen.get(header.toLowerCase())
    if (header !== '' && previous !== undefined) {
      problems.push({
        line: lines[0] ?? 1,
        kind: 'DUPLICATE_HEADER',
        detail: `"${header}" appears as both column ${previous + 1} and column ${index + 1}. Mapping would be ambiguous, so the second is ignored.`,
      })
    } else if (header !== '') {
      seen.set(header.toLowerCase(), index)
    }
    headers.push(header)
  })

  const rows: CsvRow[] = []
  let truncated = false

  for (let r = 1; r < records.length; r++) {
    if (rows.length >= MAX_ROWS) { truncated = true; break }

    const record = records[r]!
    const line = lines[r] ?? r + 1

    if (record.length < headers.length) {
      /*
        Padded rather than rejected.

        A short row is usually trailing empty columns the export omitted, and
        throwing away a decline worth $1,400 because its optional reason field
        was missing would be the wrong trade. The problem is still reported so
        a genuinely malformed file is visible.
      */
      problems.push({
        line,
        kind: 'TOO_FEW_COLUMNS',
        detail: `${record.length} value(s) for ${headers.length} columns. Missing values were read as empty.`,
      })
      while (record.length < headers.length) record.push('')
    } else if (record.length > headers.length) {
      problems.push({
        line,
        kind: 'TOO_MANY_COLUMNS',
        detail: `${record.length} values for ${headers.length} columns — usually an unquoted comma inside a value. The extra values were dropped.`,
      })
      record.length = headers.length
    }

    rows.push({ values: record, line })
  }

  return { headers, rows, problems, truncated }
}

/** One row as a lookup by header name. Convenience for the mapping layer. */
export function toRecord(headers: string[], row: CsvRow): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((header, i) => {
    if (header !== '') out[header] = row.values[i] ?? ''
  })
  return out
}
