'use server'

import { revalidatePath } from 'next/cache'
import { requireUser, checkAccess } from '@/lib/auth/session'
import { canManageStaff } from '@/lib/team/roster'
import { parseCsv } from '@/lib/import/csv'
import { validateRows, type ColumnMapping } from '@/lib/import/mapping'
import { entityDef, type ImportEntity } from '@/lib/import/entities'
import { importDeclinedServices, MAX_IMPORT_ROWS, type ImportOutcome } from '@/lib/import/persist'

/**
 * Running an import.
 *
 * ---------------------------------------------------------------------------
 * THE PREVIEW HAPPENS IN THE BROWSER; ONLY THE COMMIT COMES HERE
 * ---------------------------------------------------------------------------
 * The parser and the validator are pure, so the wizard runs them client-side
 * to show headers, the suggested mapping and the rejections — instantly, with
 * no upload and no size limit. A manager can fix a mapping and watch the
 * numbers move without a round trip, which is the difference between a screen
 * somebody uses and one they abandon.
 *
 * This action is the commit. It deliberately re-parses and re-validates the
 * file server-side rather than trusting rows the client sends: everything
 * arriving from a browser is a claim, and "these 20,000 declines are valid,
 * take my word for it" is the last claim to accept unchecked. The client-side
 * pass is a convenience for the human, never the authority.
 */

export interface ImportState {
  error?: string
  outcome?: ImportOutcome
}

/** Guardrails before a single row is read. */
const MAX_BYTES = 4_000_000

export async function runImport(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const user = await requireUser()
  if (!canManageStaff(user.role)) {
    return { error: 'Only a service manager or administrator can import history.' }
  }

  /*
    Gated on billing, unlike almost everything else.

    A bulk write is administrative rather than part of the drive, so it belongs
    with inviting staff and changing integrations on the restricted list. An
    advisor mid-conversation is never blocked by this.
  */
  const access = await checkAccess('MANAGE_INTEGRATIONS')
  if (!access.allowed) return { error: access.error }

  const entity = String(formData.get('entity') ?? '') as ImportEntity
  const fileName = String(formData.get('fileName') ?? 'import.csv')
  const text = String(formData.get('text') ?? '')

  let mapping: ColumnMapping
  try {
    mapping = JSON.parse(String(formData.get('mapping') ?? '{}')) as ColumnMapping
  } catch {
    return { error: 'The column mapping could not be read. Reload and try again.' }
  }

  if (entity !== 'DECLINED_SERVICE') {
    /*
      Said plainly rather than offered and broken.

      Vehicles and service history are defined in ./entities and parse and
      validate today; only their persistence is unwritten. Showing them as
      choices that silently do nothing would be worse than a sentence saying
      what is not built yet.
    */
    return { error: 'Only declined services can be imported so far. Vehicles and service history are next.' }
  }

  if (text.length === 0) return { error: 'No file was received. Choose a CSV and try again.' }
  if (text.length > MAX_BYTES) {
    return { error: `That file is ${(text.length / 1_000_000).toFixed(1)}MB, above the 4MB an import accepts. Split it and run the parts — re-running is safe, duplicates are skipped.` }
  }

  const def = entityDef(entity)
  const missing = def.fields.filter((f) => f.required && !mapping[f.key])
  if (missing.length > 0) {
    return { error: `Map a column to ${missing.map((f) => f.label).join(', ')} before importing.` }
  }

  const parsed = parseCsv(text)
  if (parsed.rows.length === 0) {
    return { error: 'That file has a header but no rows.' }
  }
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    return { error: `That file has ${parsed.rows.length.toLocaleString()} rows, above the ${MAX_IMPORT_ROWS.toLocaleString()} an import processes at once. Split it and run the parts — re-running is safe, duplicates are skipped.` }
  }

  const validated = validateRows(entity, mapping, parsed.headers, parsed.rows)

  try {
    const outcome = await importDeclinedServices(user.storeId, validated.rows, fileName)

    // The rows the validator threw out never reached the importer, so they are
    // added here — a manager wants one list of what did not make it, not two.
    outcome.rejections = [...validated.rejections, ...outcome.rejections]
    outcome.rejected += validated.rejections.filter(
      (r) => !r.reason.includes('imported without it'),
    ).length
    outcome.totalRows = parsed.rows.length

    revalidatePath('/import')
    revalidatePath('/drive')
    return { outcome }
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause)
    return { error: `The import did not complete and nothing was saved: ${why}` }
  }
}
