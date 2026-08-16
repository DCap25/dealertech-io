'use client'

import { useActionState, useMemo, useState } from 'react'
import { parseCsv, type CsvParseResult } from '@/lib/import/csv'
import { suggestMapping, summarise, validateRows, type ColumnMapping } from '@/lib/import/mapping'
import { ENTITIES, entityDef, type ImportEntity } from '@/lib/import/entities'
import { runImport, type ImportState } from './actions'

/**
 * Choose a file, check the columns, see what will be dropped, import.
 *
 * ---------------------------------------------------------------------------
 * EVERYTHING BEFORE THE LAST BUTTON HAPPENS IN THE BROWSER
 * ---------------------------------------------------------------------------
 * The parser and validator are pure, so they run here. Choosing a file shows
 * the real headers, the real suggested mapping and the real rejection count
 * immediately, with no upload — and changing a mapping re-runs the whole
 * validation as you watch. That feedback loop is the difference between a
 * screen a manager uses and one they close.
 *
 * It is also the honest place to discover a problem. Finding out that the
 * Amount column mapped to the wrong thing should cost a dropdown change, not
 * an import somebody then has to unpick.
 *
 * The server re-parses and re-validates on commit regardless. Nothing here is
 * trusted; it is shown.
 */

const INITIAL: ImportState = {}

const field =
  'mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300'
const label = 'block text-xs font-semibold uppercase tracking-wide text-neutral-500'

/** Files past this are refused before the browser tries to read them. */
const MAX_BYTES = 4_000_000

export function ImportWizard() {
  const [state, formAction, pending] = useActionState(runImport, INITIAL)

  const [entity, setEntity] = useState<ImportEntity>('DECLINED_SERVICE')
  const [fileName, setFileName] = useState('')
  const [text, setText] = useState('')
  const [readError, setReadError] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<ColumnMapping>({})

  const parsed: CsvParseResult | null = useMemo(
    () => (text ? parseCsv(text) : null),
    [text],
  )

  const def = entityDef(entity)

  // The suggestion, then anything the manager changed on top of it.
  const mapping = useMemo(() => {
    if (!parsed) return {}
    const base = suggestMapping(parsed.headers, entity).mapping
    const merged: ColumnMapping = { ...base }
    for (const [key, header] of Object.entries(overrides)) {
      if (header === '') delete merged[key]
      else merged[key] = header
    }
    return merged
  }, [parsed, entity, overrides])

  const preview = useMemo(() => {
    if (!parsed) return null
    const result = validateRows(entity, mapping, parsed.headers, parsed.rows)
    return summarise(result, parsed.rows.length)
  }, [parsed, entity, mapping])

  const missingRequired = def.fields.filter((f) => f.required && !mapping[f.key])
  const ready = Boolean(parsed) && missingRequired.length === 0 && (preview?.willImport ?? 0) > 0

  async function onFile(file: File | undefined) {
    setReadError(null)
    setOverrides({})
    if (!file) { setText(''); setFileName(''); return }

    if (file.size > MAX_BYTES) {
      setText(''); setFileName('')
      setReadError(
        `That file is ${(file.size / 1_000_000).toFixed(1)}MB, above the 4MB an import accepts. Split it and run the parts — re-running is safe, duplicates are skipped.`,
      )
      return
    }

    setFileName(file.name)
    setText(await file.text())
  }

  // ---- the result of a completed run replaces the wizard
  if (state.outcome) {
    const o = state.outcome
    return (
      <section className="mt-6 rounded-2xl border border-emerald-300 bg-emerald-50 p-5 dark:border-emerald-800 dark:bg-emerald-950">
        <h2 className="text-lg font-bold text-emerald-900 dark:text-emerald-100">
          Imported {o.imported.toLocaleString()} of {o.totalRows.toLocaleString()} rows
        </h2>

        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
          <Stat label="Declines added" value={o.imported} />
          <Stat label="Already on file" value={o.skippedDuplicates} />
          <Stat label="Vehicles created" value={o.vehiclesCreated} />
          <Stat label="Customers created" value={o.customersCreated} />
        </dl>

        {o.notes.length > 0 && (
          <ul className="mt-4 space-y-1.5 text-sm text-emerald-900/90 dark:text-emerald-100/90">
            {o.notes.map((n, i) => <li key={i}>· {n}</li>)}
          </ul>
        )}

        {o.rejected > 0 && (
          <details className="mt-4 rounded-lg bg-white/70 p-3 dark:bg-black/20">
            <summary className="cursor-pointer text-sm font-semibold">
              {o.rejected.toLocaleString()} row(s) were not imported — see why
            </summary>
            <RejectionList rejections={o.rejections} />
            <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
              Fix these in the spreadsheet and import the file again. Rows already
              here are skipped, so re-running costs nothing.
            </p>
          </details>
        )}

        <a href="/import" className="mt-5 inline-block text-sm font-semibold underline">
          Import another file
        </a>
      </section>
    )
  }

  return (
    <form action={formAction} className="mt-6 space-y-6">
      <input type="hidden" name="entity" value={entity} />
      <input type="hidden" name="fileName" value={fileName} />
      <input type="hidden" name="text" value={text} />
      <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />

      {/* ---- 1. what kind of file */}
      <section className="rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
        <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500">
          1 · What are you importing?
        </h2>
        <div className="mt-3 space-y-2">
          {ENTITIES.map((e) => (
            <label
              key={e.key}
              className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${
                entity === e.key
                  ? 'border-neutral-900 bg-neutral-50 dark:border-neutral-300 dark:bg-neutral-900'
                  : 'border-neutral-200 dark:border-neutral-800'
              }`}
            >
              <input
                type="radio"
                name="entityChoice"
                className="mt-1"
                checked={entity === e.key}
                onChange={() => { setEntity(e.key); setOverrides({}) }}
              />
              <span>
                <span className="block text-sm font-semibold">
                  {e.label}
                  {e.key !== 'DECLINED_SERVICE' && (
                    <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase dark:bg-neutral-800">
                      not yet
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-neutral-600 dark:text-neutral-400">
                  {e.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>

      {/* ---- 2. the file */}
      <section className="rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
        <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500">
          2 · Choose the file
        </h2>
        <input
          type="file"
          accept=".csv,text/csv"
          className="mt-3 block w-full text-sm"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <p className="mt-2 text-xs text-neutral-500">
          A CSV exported from your DMS. Nothing is uploaded until you press import —
          the columns and the preview below are read in your browser.
        </p>

        {readError && (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-200">
            {readError}
          </p>
        )}

        {parsed && parsed.problems.length > 0 && (
          <details className="mt-3 rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950">
            <summary className="cursor-pointer font-semibold text-amber-900 dark:text-amber-200">
              {parsed.problems.length} thing(s) to know about this file
            </summary>
            <ul className="mt-2 space-y-1 text-xs text-amber-900/90 dark:text-amber-200/90">
              {parsed.problems.slice(0, 15).map((p, i) => (
                <li key={i}>Line {p.line}: {p.detail}</li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* ---- 3. columns */}
      {parsed && (
        <section className="rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
          <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500">
            3 · Check the columns
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            Matched by name where we recognised it. Anything we were not sure about is
            left blank rather than guessed — a wrong guess imports wrong data quietly.
          </p>

          <div className="mt-4 space-y-3">
            {def.fields.map((f) => (
              <div key={f.key} className="grid gap-2 sm:grid-cols-[13rem_1fr] sm:items-start">
                <div>
                  <span className={label}>
                    {f.label}
                    {f.required && <span className="ml-1 text-rose-600">*</span>}
                  </span>
                  {f.hint && (
                    <span className="mt-0.5 block text-[11px] leading-snug text-neutral-500">
                      {f.hint}
                    </span>
                  )}
                </div>
                <select
                  className={field}
                  value={mapping[f.key] ?? ''}
                  onChange={(e) => setOverrides((o) => ({ ...o, [f.key]: e.target.value }))}
                >
                  <option value="">— not imported —</option>
                  {parsed.headers.filter((h) => h !== '').map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---- 4. what will happen */}
      {parsed && preview && (
        <section className="rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
          <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500">
            4 · What will happen
          </h2>

          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <Stat label="Rows in the file" value={preview.totalRows} />
            <Stat label="Will import" value={preview.willImport} tone="good" />
            <Stat
              label="Will be skipped"
              value={preview.willReject}
              tone={preview.willReject > 0 ? 'warn' : undefined}
            />
          </dl>

          {missingRequired.length > 0 && (
            <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-200">
              Map a column to {missingRequired.map((f) => f.label).join(', ')} before importing.
            </p>
          )}

          {preview.alwaysEmpty.length > 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {preview.alwaysEmpty.join(', ')} mapped to a column that is empty on every
              row. That is usually the wrong column — worth a second look before importing.
            </p>
          )}

          {preview.sampleRejections.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold">
                Why rows are being skipped
              </summary>
              <RejectionList rejections={preview.sampleRejections} />
            </details>
          )}
        </section>
      )}

      {state.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-200">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!ready || pending}
          className="touch-target rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
        >
          {pending
            ? 'Importing…'
            : preview
              ? `Import ${preview.willImport.toLocaleString()} row(s)`
              : 'Import'}
        </button>
        {pending && (
          <span className="text-xs text-neutral-500">
            Large files take a moment. Do not close this tab.
          </span>
        )}
      </div>
    </form>
  )
}

function Stat({ label: text, value, tone }: {
  label: string
  value: number
  tone?: 'good' | 'warn'
}) {
  const colour = tone === 'good'
    ? 'text-emerald-700 dark:text-emerald-400'
    : tone === 'warn'
      ? 'text-amber-700 dark:text-amber-400'
      : ''
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-neutral-500">{text}</dt>
      <dd className={`mt-0.5 text-2xl font-bold tabular-nums ${colour}`}>
        {value.toLocaleString()}
      </dd>
    </div>
  )
}

/**
 * Rejections, grouped by reason.
 *
 * Twenty thousand rows with the same broken column produce twenty thousand
 * identical messages, and a list that long is one nobody reads. Grouping turns
 * it into "1,204 rows: VIN fails its check digit" — which is one fix in a
 * spreadsheet rather than an afternoon.
 */
function RejectionList({ rejections }: { rejections: { line: number; fieldLabel: string; value: string; reason: string }[] }) {
  const grouped = new Map<string, { reason: string; lines: number[]; sample: string }>()
  for (const r of rejections) {
    const existing = grouped.get(r.reason)
    if (existing) existing.lines.push(r.line)
    else grouped.set(r.reason, { reason: r.reason, lines: [r.line], sample: r.value })
  }

  return (
    <ul className="mt-2 space-y-2 text-xs">
      {[...grouped.values()].map((g, i) => (
        <li key={i} className="rounded-lg bg-neutral-100 p-2 dark:bg-neutral-900">
          <p className="font-semibold">{g.reason}</p>
          <p className="mt-0.5 text-neutral-600 dark:text-neutral-400">
            {g.lines.length.toLocaleString()} row(s) — first at line {g.lines[0]}
            {g.sample && <> · example value: <span className="font-mono">{g.sample}</span></>}
          </p>
        </li>
      ))}
    </ul>
  )
}
