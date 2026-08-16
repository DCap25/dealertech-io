import { toRecord, type CsvRow } from './csv'
import { isBlank } from './coerce'
import { coerceField, entityDef, type EntityDef, type FieldDef, type ImportEntity } from './entities'

/**
 * Matching somebody's columns to ours, then deciding what survives.
 *
 * ---------------------------------------------------------------------------
 * THE MAPPING SCREEN IS WHERE IMPORTS DIE
 * ---------------------------------------------------------------------------
 * A service manager who opens a page asking them to match nineteen columns by
 * hand closes it again and the store never gets its history. So the matching
 * is done for them wherever the header is recognisable, and the screen becomes
 * a confirmation rather than a chore.
 *
 * It is a suggestion, never a decision: the guess is always shown and always
 * overridable, because a column called `Amount` in an export with four money
 * columns is exactly the kind of thing a machine gets confidently wrong.
 *
 * ---------------------------------------------------------------------------
 * AND WHY A BAD ROW DOES NOT FAIL THE FILE
 * ---------------------------------------------------------------------------
 * Twenty thousand rows will contain some rubbish — a VIN with a typo, a date
 * from 1900, an amount in a currency column that says "see notes". Rejecting
 * the whole import over forty bad rows loses the nineteen thousand good ones
 * and the store gives up. Each row stands or falls alone, and the ones that
 * fall are reported with enough detail to fix in a spreadsheet.
 *
 * Pure and I/O-free.
 */

/** Strip everything that varies between exports of the same column. */
export function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** field key → the CSV header it reads from. Absent means unmapped. */
export type ColumnMapping = Record<string, string>

export interface MappingSuggestion {
  mapping: ColumnMapping
  /** Required fields no header matched. The import cannot run until these are set. */
  unmappedRequired: FieldDef[]
  /** Headers we made no use of. Shown so somebody can spot a missed column. */
  unusedHeaders: string[]
}

/**
 * Guess which column is which.
 *
 * Exact alias match only — no fuzzy distance scoring. A near-miss that maps
 * `Parts Amount` onto `quotedAmount` because the strings are similar is worse
 * than leaving it blank: an unmapped field is visible on the screen, while a
 * confidently wrong one imports twenty thousand incorrect prices.
 *
 * First header wins where several match, and each header is used once, so an
 * export with both `Mileage` and `Odometer` maps one and offers the other.
 */
export function suggestMapping(headers: string[], entity: ImportEntity): MappingSuggestion {
  const def = entityDef(entity)
  const mapping: ColumnMapping = {}
  const taken = new Set<string>()

  const normalised = headers
    .filter((h) => h !== '')
    .map((h) => ({ raw: h, norm: normaliseHeader(h) }))

  for (const field of def.fields) {
    const candidates = new Set([
      normaliseHeader(field.key),
      normaliseHeader(field.label),
      ...field.aliases.map(normaliseHeader),
    ])

    const hit = normalised.find((h) => !taken.has(h.raw) && candidates.has(h.norm))
    if (hit) {
      mapping[field.key] = hit.raw
      taken.add(hit.raw)
    }
  }

  return {
    mapping,
    unmappedRequired: def.fields.filter((f) => f.required && !mapping[f.key]),
    unusedHeaders: normalised.filter((h) => !taken.has(h.raw)).map((h) => h.raw),
  }
}

export interface ImportedRow {
  line: number
  /** Keyed by field key. Only fields that were mapped and coerced cleanly. */
  fields: Record<string, string | number | Date>
}

export interface RowRejection {
  line: number
  field: string
  fieldLabel: string
  /** What was in the cell, so it can be found in the spreadsheet. */
  value: string
  reason: string
}

export interface ValidationResult {
  entity: ImportEntity
  rows: ImportedRow[]
  rejections: RowRejection[]
  /** Fields that were mapped but empty on every single row. */
  alwaysEmpty: string[]
}

/**
 * Coerce and validate every row against an entity.
 *
 * A row is rejected on the first required field it fails. Reporting every
 * fault on a broken row sounds more helpful and is not — a row with a mangled
 * VIN usually has a mangled everything, and six rejections per row buries the
 * forty rows that have one real problem each.
 *
 * Optional fields that fail are dropped quietly on the row and kept in the
 * rejection list. Losing a decline because its optional mileage column said
 * "see notes" would be the wrong trade; losing the mileage is not.
 */
export function validateRows(
  entity: ImportEntity,
  mapping: ColumnMapping,
  headers: string[],
  rows: CsvRow[],
  asOf: Date = new Date(),
): ValidationResult {
  const def: EntityDef = entityDef(entity)
  const out: ImportedRow[] = []
  const rejections: RowRejection[] = []

  const mappedFields = def.fields.filter((f) => mapping[f.key])
  const seenValue = new Set<string>()

  for (const row of rows) {
    const record = toRecord(headers, row)
    const fields: Record<string, string | number | Date> = {}
    let rejected = false

    for (const field of mappedFields) {
      const header = mapping[field.key]!
      const raw = record[header] ?? ''

      if (isBlank(raw)) {
        if (field.required) {
          rejections.push({
            line: row.line,
            field: field.key,
            fieldLabel: field.label,
            value: raw,
            reason: `${field.label} is required and this row has no value for it.`,
          })
          rejected = true
          break
        }
        continue
      }

      seenValue.add(field.key)
      const coerced = coerceField(field, raw, asOf)

      if (!coerced.ok) {
        if (field.required) {
          rejections.push({
            line: row.line,
            field: field.key,
            fieldLabel: field.label,
            value: raw.slice(0, 80),
            reason: `${field.label} ${coerced.reason}.`,
          })
          rejected = true
          break
        }
        // Optional and unreadable: keep the row, lose the field, say so.
        rejections.push({
          line: row.line,
          field: field.key,
          fieldLabel: field.label,
          value: raw.slice(0, 80),
          reason: `${field.label} ${coerced.reason}. The row was imported without it.`,
        })
        continue
      }

      fields[field.key] = coerced.value
    }

    if (!rejected) out.push({ line: row.line, fields })
  }

  return {
    entity,
    rows: out,
    rejections,
    /*
      A column mapped to something that turned out to be empty on every row.

      Almost always a mis-map — the right-looking header on the wrong column —
      and it is invisible otherwise, because nothing failed. Worth saying
      before somebody imports twenty thousand declines with no amounts.
    */
    alwaysEmpty: mappedFields.filter((f) => !seenValue.has(f.key)).map((f) => f.label),
  }
}

export interface ImportPreview {
  totalRows: number
  willImport: number
  willReject: number
  /** Distinct lines that failed, not distinct problems — one row can raise several. */
  rejectedLines: number
  alwaysEmpty: string[]
  /** A handful of real rejections, to show rather than describe. */
  sampleRejections: RowRejection[]
}

/**
 * What to put in front of somebody before they commit.
 *
 * The count that matters is `willImport`. A manager deciding whether to run
 * this needs one number they can sanity-check against what they exported, and
 * a few real examples of what is being dropped — not a percentage.
 */
export function summarise(result: ValidationResult, totalRows: number): ImportPreview {
  const rejectedLines = new Set(
    result.rejections
      .filter((r) => !r.reason.includes('imported without it'))
      .map((r) => r.line),
  )

  return {
    totalRows,
    willImport: result.rows.length,
    willReject: rejectedLines.size,
    rejectedLines: rejectedLines.size,
    alwaysEmpty: result.alwaysEmpty,
    sampleRejections: result.rejections.slice(0, 20),
  }
}
