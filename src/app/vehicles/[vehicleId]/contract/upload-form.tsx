'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { uploadAndExtract, saveConfirmed, type UploadState } from './actions'
import {
  PRODUCT_VOCABULARY,
  UPLOAD_ACCEPT_ATTRIBUTE,
  type ExtractedContract,
  type ExtractionDraft,
  type ExtractionOutcome,
} from '@/lib/contract-capture'

/**
 * Upload, then review.
 *
 * The review screen is the safety mechanism, so it is built to be used rather
 * than clicked through: every field shows the characters the model says it
 * read, the ones it was unsure about are marked, and the ones it could not
 * find at all say so instead of sitting empty and ambiguous. The advisor is
 * checking a transcription against a document, which is quick, instead of
 * hunting for what changed.
 */

const PRODUCTS = PRODUCT_VOCABULARY.map((p) => ({ value: p.value, label: p.label }))

const TIER_TYPES = [
  { value: 'EXCLUSIONARY', label: 'Exclusionary — lists what is not covered' },
  { value: 'INCLUSIONARY', label: 'Inclusionary — lists what is covered' },
]

const DEDUCTIBLE_TYPES = [
  { value: 'NONE', label: 'None' },
  { value: 'PER_VISIT', label: 'Per visit' },
  { value: 'PER_REPAIR', label: 'Per repair' },
]

const PRIOR_AUTH = [
  { value: 'true', label: 'Yes — call before teardown' },
  { value: 'false', label: 'No' },
]

const CONFIDENCE_STYLE: Record<string, string> = {
  HIGH: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  MEDIUM: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  LOW: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
}

/**
 * What the model found, or that it did not.
 *
 * "Not found" is its own state rather than an empty box with a confidence
 * badge on it. An advisor who sees a blank field cannot tell whether the model
 * read the document and found nothing there, or never got that far — and those
 * call for different things: one means the contract genuinely does not print
 * it, the other means go and look.
 */
function FieldBadge({ field }: { field: ExtractedContract[keyof ExtractedContract] }) {
  if (field.value === null) {
    return (
      <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
        not found
      </span>
    )
  }
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
        CONFIDENCE_STYLE[field.confidence]
      }`}
    >
      {field.confidence === 'HIGH' ? 'clear' : field.confidence === 'MEDIUM' ? 'check this' : 'unsure'}
    </span>
  )
}

function Field({
  name,
  label,
  field,
  type = 'text',
  options,
  hint,
}: {
  name: keyof ExtractedContract
  label: string
  field: ExtractedContract[keyof ExtractedContract]
  type?: string
  options?: { value: string; label: string }[]
  hint?: string
}) {
  const value = field.value === null ? '' : String(field.value)

  return (
    <div className="border-t border-[var(--border)] py-3.5 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor={name} className="text-sm font-semibold">
          {label}
        </label>
        <FieldBadge field={field} />
      </div>

      {options ? (
        <select
          id={name}
          name={name}
          defaultValue={value}
          className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
        >
          <option value="">— not set —</option>
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

      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}

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

/**
 * Why the form looks the way it does.
 *
 * The keyless case is not an error and is not apologised for — it is a
 * configuration fact with an action attached. Nothing here ever claims a
 * document was read when it was not.
 */
function OutcomeNote({ outcome }: { outcome: ExtractionOutcome }) {
  if (outcome === 'NO_PROVIDER') {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
        <p className="text-sm font-semibold">Nothing read this document</p>
        <p className="mt-1 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
          Automatic extraction is not switched on, so the document has been filed against this
          vehicle and the fields below are blank. Add an API key to have contracts read
          automatically — or enter the details yourself now. Either way the coverage works the same
          once it is saved.
        </p>
      </div>
    )
  }

  if (outcome === 'FAILED') {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
          The document could not be read
        </p>
        <p className="mt-1 text-sm leading-relaxed text-amber-800 dark:text-amber-200">
          It is stored against this vehicle and nothing was lost. Enter the details below, or try
          uploading a clearer copy.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
      <p className="text-sm font-semibold">Check this against the document</p>
      <p className="mt-1 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
        Nothing here is used until you save it. Fields marked “not found” were not on the document
        as far as the reader could tell — check before assuming they are absent.
      </p>
    </div>
  )
}

export function UploadForm({
  vehicleId,
  vehicleLabel,
  vin,
}: {
  vehicleId: string
  vehicleLabel: string
  vin: string
}) {
  const [uploadState, upload, uploading] = useActionState<UploadState, FormData>(
    uploadAndExtract,
    { status: 'IDLE' },
  )
  const [saveState, save, saving] = useActionState<UploadState, FormData>(saveConfirmed, {
    status: 'IDLE',
  })

  const draft: ExtractionDraft | undefined = saveState.draft ?? uploadState.draft
  const documentId = saveState.documentId ?? uploadState.documentId
  const outcome: ExtractionOutcome = uploadState.outcome ?? 'EXTRACTED'
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
        <form action={upload} className="rounded-2xl border border-[var(--border)] p-5">
          <input type="hidden" name="vehicleId" value={vehicleId} />
          <label htmlFor="document" className="text-sm font-semibold">
            The service agreement
          </label>
          <p className="mt-1 text-sm text-neutral-500">
            A PDF, or a photo of the pages with the product name, administrator, dates and VIN on
            them. Up to 20MB.
          </p>
          <input
            id="document"
            name="document"
            type="file"
            accept={UPLOAD_ACCEPT_ATTRIBUTE}
            required
            className="mt-3 block w-full text-sm file:mr-4 file:rounded-xl file:border-0 file:bg-neutral-900 file:px-4 file:py-2.5 file:text-sm file:font-bold file:text-white dark:file:bg-white dark:file:text-neutral-900"
          />
          <button
            type="submit"
            disabled={uploading}
            className="touch-target mt-4 w-full rounded-xl bg-neutral-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {uploading ? 'Reading the document…' : 'Upload and read'}
          </button>
          {uploadState.status === 'ERROR' && (
            <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">
              {uploadState.message}
            </p>
          )}
        </form>
      )}

      {draft && (
        <form action={save} className="space-y-5">
          <input type="hidden" name="documentId" value={documentId ?? ''} />
          <input type="hidden" name="vehicleId" value={vehicleId} />

          <OutcomeNote outcome={outcome} />

          <p className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            A wrong reading means telling {vehicleLabel}&rsquo;s owner a repair is covered when it
            is not.
          </p>

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
            <Field name="coverageTier" label="Plan / tier name" field={draft.contract.coverageTier} />
            <Field
              name="tierType"
              label="Coverage style"
              field={draft.contract.tierType}
              options={TIER_TYPES}
              hint="Exclusionary is assumed when unset — the more generous reading."
            />
          </div>

          <div className="rounded-2xl border border-[var(--border)] px-5 py-1">
            <Field name="purchaseDate" label="Purchase date" field={draft.contract.purchaseDate} type="date" />
            <Field name="purchaseMileage" label="Mileage at purchase" field={draft.contract.purchaseMileage} type="number" />
            <Field name="termMonths" label="Term (months)" field={draft.contract.termMonths} type="number" />
            <Field name="termMiles" label="Term (miles)" field={draft.contract.termMiles} type="number" />
            <Field name="expirationDate" label="Expires (date)" field={draft.contract.expirationDate} type="date" />
            <Field
              name="expirationMiles"
              label="Expires (odometer)"
              field={draft.contract.expirationMiles}
              type="number"
              hint="An absolute odometer limit, if the contract states one — not the term in miles."
            />
          </div>

          <div className="rounded-2xl border border-[var(--border)] px-5 py-1">
            <Field name="deductibleAmount" label="Deductible ($)" field={draft.contract.deductibleAmount} type="number" />
            <Field name="deductibleType" label="Deductible applies" field={draft.contract.deductibleType} options={DEDUCTIBLE_TYPES} />
            <Field
              name="requiresPriorAuthorization"
              label="Prior authorisation"
              field={draft.contract.requiresPriorAuthorization}
              options={PRIOR_AUTH}
              hint="Assumed required when unset. Starting work without the call is the most common reason a valid claim is denied."
            />
            <Field name="vin" label="VIN on the document" field={draft.contract.vin} />
          </div>

          <p className="text-xs leading-relaxed text-neutral-500">
            This vehicle is <span className="font-mono">{vin}</span>. Saved coverage is marked as
            read from a document and stays unverified until somebody confirms the policy with the
            administrator — the coverage engine keeps saying so on every answer it drives.
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
