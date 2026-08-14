'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { extractFromPhoto, saveConfirmed, type CaptureState } from './actions'
import type { ExtractedContract, ExtractionDraft } from '@/lib/contract-capture'

/**
 * Capture, then review.
 *
 * The review screen is the safety mechanism, so it is built to be used rather
 * than clicked through: every field shows the characters the model says it
 * read, and the ones it was unsure about are marked. The advisor is checking a
 * transcription against paper in their hand, which is quick, instead of
 * hunting for what changed.
 */

const PRODUCTS: { value: string; label: string }[] = [
  { value: 'VSC', label: 'Vehicle service contract' },
  { value: 'PPM', label: 'Prepaid maintenance' },
  { value: 'TIRE_WHEEL', label: 'Tire & wheel / road hazard' },
  { value: 'DENT', label: 'Dent & ding / PDR' },
  { value: 'APPEARANCE', label: 'Cosmetic / alloy wheel / appearance' },
  { value: 'WINDSHIELD', label: 'Windshield / glass' },
  { value: 'KEY', label: 'Key replacement' },
  { value: 'THEFT', label: 'Theft / etch' },
]

const CONFIDENCE_STYLE: Record<string, string> = {
  HIGH: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  MEDIUM: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  LOW: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
}

function Field({
  name,
  label,
  field,
  type = 'text',
  options,
}: {
  name: keyof ExtractedContract
  label: string
  field: ExtractedContract[keyof ExtractedContract]
  type?: string
  options?: { value: string; label: string }[]
}) {
  const value = field.value === null ? '' : String(field.value)

  return (
    <div className="border-t border-[var(--border)] py-3.5 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor={name} className="text-sm font-semibold">
          {label}
        </label>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            CONFIDENCE_STYLE[field.confidence]
          }`}
        >
          {field.confidence === 'HIGH' ? 'clear' : field.confidence === 'MEDIUM' ? 'check this' : 'unsure'}
        </span>
      </div>

      {options ? (
        <select
          id={name}
          name={name}
          defaultValue={value}
          className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
        >
          <option value="">— choose —</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={name}
          name={name}
          type={type}
          defaultValue={value}
          className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
        />
      )}

      {/*
        What the model says it read. This is the whole reason the review is
        fast — the advisor's eye goes to that spot on the page rather than
        re-reading it.
      */}
      {field.sourceText && (
        <p className="mt-1.5 font-mono text-xs text-neutral-500">
          read from: “{field.sourceText}”
        </p>
      )}
    </div>
  )
}

export function CaptureForm({
  vehicleId,
  vehicleLabel,
  vin,
}: {
  vehicleId: string
  vehicleLabel: string
  vin: string
}) {
  const [captureState, capture, capturing] = useActionState<CaptureState, FormData>(
    extractFromPhoto,
    { status: 'IDLE' },
  )
  const [saveState, save, saving] = useActionState<CaptureState, FormData>(saveConfirmed, {
    status: 'IDLE',
  })

  const draft: ExtractionDraft | undefined = saveState.draft ?? captureState.draft
  const captureId = saveState.captureId ?? captureState.captureId
  const blocking = draft?.issues.filter((i) => i.severity === 'BLOCKING') ?? []
  const warnings = draft?.issues.filter((i) => i.severity === 'WARNING') ?? []

  if (saveState.status === 'SAVED') {
    return (
      <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-6 dark:border-emerald-800 dark:bg-emerald-950">
        <p className="text-lg font-bold text-emerald-900 dark:text-emerald-100">Coverage added</p>
        <p className="mt-1.5 text-sm text-emerald-800 dark:text-emerald-200">{saveState.message}</p>
        <Link
          href={`/vehicles/${vehicleId}`}
          className="touch-target mt-5 inline-block rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-bold text-white dark:bg-white dark:text-neutral-900"
        >
          Back to the vehicle
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {!draft && (
        <form action={capture} className="rounded-2xl border border-[var(--border)] p-5">
          <input type="hidden" name="vehicleId" value={vehicleId} />
          <label htmlFor="photo" className="text-sm font-semibold">
            Photograph the contract
          </label>
          <p className="mt-1 text-sm text-neutral-500">
            The page with the product name, administrator, dates and VIN on it. Flat, in good light,
            whole page in frame.
          </p>
          <input
            id="photo"
            name="photo"
            type="file"
            accept="image/*"
            // Opens the camera directly on a tablet rather than the file picker.
            capture="environment"
            required
            className="mt-3 block w-full text-sm file:mr-4 file:rounded-xl file:border-0 file:bg-neutral-900 file:px-4 file:py-2.5 file:text-sm file:font-bold file:text-white dark:file:bg-white dark:file:text-neutral-900"
          />
          <button
            type="submit"
            disabled={capturing}
            className="touch-target mt-4 w-full rounded-xl bg-neutral-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {capturing ? 'Reading the document…' : 'Read this contract'}
          </button>
          {captureState.status === 'ERROR' && (
            <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">
              {captureState.message}
            </p>
          )}
        </form>
      )}

      {draft && (
        <form action={save} className="space-y-5">
          <input type="hidden" name="captureId" value={captureId ?? ''} />
          <input type="hidden" name="vehicleId" value={vehicleId} />

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <p className="text-sm font-semibold">Check this against the document</p>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              Nothing here is used until you save it. A wrong reading means telling{' '}
              {vehicleLabel}&rsquo;s owner a repair is covered when it is not.
            </p>
          </div>

          {blocking.map((i) => (
            <p
              key={i.message}
              className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"
            >
              {i.message}
            </p>
          ))}
          {warnings.map((i) => (
            <p
              key={i.message}
              className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
            >
              {i.message}
            </p>
          ))}

          <div className="rounded-2xl border border-[var(--border)] px-5 py-1">
            <Field name="productType" label="Product" field={draft.contract.productType} options={PRODUCTS} />
            <Field name="adminCompany" label="Administrator" field={draft.contract.adminCompany} />
            <Field name="contractNumber" label="Contract number" field={draft.contract.contractNumber} />
            <Field name="purchaseDate" label="Purchase date" field={draft.contract.purchaseDate} type="date" />
            <Field name="expirationDate" label="Expires" field={draft.contract.expirationDate} type="date" />
            <Field name="termMonths" label="Term (months)" field={draft.contract.termMonths} type="number" />
            <Field name="termMiles" label="Term (miles)" field={draft.contract.termMiles} type="number" />
            <Field name="deductibleAmount" label="Deductible ($)" field={draft.contract.deductibleAmount} type="number" />
            <Field name="vin" label="VIN on the document" field={draft.contract.vin} />
          </div>

          <p className="text-xs leading-relaxed text-neutral-500">
            This vehicle is <span className="font-mono">{vin}</span>. Saved coverage is marked as read
            from a document — the coverage engine keeps that provenance, and claims are still
            confirmed with the administrator before work begins.
          </p>

          {saveState.status === 'ERROR' && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">
              {saveState.message}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={saving || blocking.length > 0}
              className="touch-target flex-1 rounded-xl bg-neutral-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
            >
              {saving ? 'Saving…' : 'Confirm and add coverage'}
            </button>
            <Link
              href={`/vehicles/${vehicleId}`}
              className="touch-target rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-bold"
            >
              Cancel
            </Link>
          </div>
        </form>
      )}
    </div>
  )
}
