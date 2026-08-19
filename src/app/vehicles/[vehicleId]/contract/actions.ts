'use server'

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope } from '@/db/scoped'
import { requireUser } from '@/lib/auth/session'
import { fenceSales } from '@/lib/auth/sales'
import { FixedWindowLimiter } from '@/lib/rate-limit/window'
import {
  confirmContract, rejectContractDocument, uploadContractDocument,
} from '@/lib/contract-capture/store'
import { reviewExtraction } from '@/lib/contract-capture/review'
import { buildConfirmedValues, readSubmittedContract } from '@/lib/contract-capture/confirm'
import { checkUpload } from '@/lib/contract-capture/upload'
import type { ExtractionDraft, ExtractionOutcome } from '@/lib/contract-capture/types'

/**
 * Uploading a service agreement, and confirming what a model read off it.
 *
 * Thin on purpose. The rules live in pure modules under
 * src/lib/contract-capture — what a file has to be (`checkUpload`), what the
 * model's answer means (`normaliseExtraction`), whether a draft is safe to save
 * (`reviewExtraction`), and what actually gets written (`buildConfirmedValues`).
 * All four are tested. What is left here is session, scope, spend and routing.
 */

/**
 * The spend guard.
 *
 * Every extraction is a paid call over a multi-megabyte document, so this is
 * money rather than data. Twelve an hour per advisor is far above any real
 * podium workflow — a store confirming a dozen contracts in an hour is having
 * an extraordinary day — and far below what a stuck retry loop or a leaned-on
 * button could spend before anyone noticed.
 *
 * Keyed by user rather than address: the cost follows the account, and the
 * limiter's own docs are clear that a forwarded address is a bucketing key
 * rather than an identity. A signed-in user id is the real subject here.
 *
 * The limiter is an in-memory speed bump per server instance — see
 * src/lib/rate-limit/window.ts for exactly how much that is and is not worth.
 * It is the second line regardless: the first is that extraction only ever
 * runs on an explicit upload, once, never on a page load or a retry.
 */
const extractionLimiter = new FixedWindowLimiter({ limit: 12, windowMs: 60 * 60_000 })

export interface UploadState {
  status: 'IDLE' | 'DRAFT' | 'ERROR' | 'SAVED'
  documentId?: string
  draft?: ExtractionDraft
  outcome?: ExtractionOutcome
  message?: string
}

/**
 * The vehicle, re-read from its id.
 *
 * The VIN a draft is checked against comes from here, never from the form. A
 * client that could supply the VIN could supply one that matches the document,
 * which would defeat the only blocking check in the flow.
 */
async function loadVehicle(storeId: string, vehicleId: string) {
  const [vehicle] = await withCurrentUserScope((db) => db
    .select({
      id: schema.vehicles.id,
      vin: schema.vehicles.vin,
      make: schema.vehicles.make,
      model: schema.vehicles.model,
      modelYear: schema.vehicles.modelYear,
    })
    .from(schema.vehicles)
    .where(and(eq(schema.vehicles.id, vehicleId), eq(schema.vehicles.storeId, storeId)))
    .limit(1))
  return vehicle ?? null
}

async function currentOwnerId(storeId: string, vehicleId: string): Promise<string | null> {
  const [link] = await withCurrentUserScope((db) => db
    .select({ customerId: schema.customerVehicles.customerId })
    .from(schema.customerVehicles)
    .where(
      and(
        eq(schema.customerVehicles.storeId, storeId),
        eq(schema.customerVehicles.vehicleId, vehicleId),
        eq(schema.customerVehicles.isCurrent, true),
      ),
    )
    .limit(1))
  return link?.customerId ?? null
}

function vehicleContext(vehicle: {
  vin: string
  make: string
  model: string | null
  modelYear: number
}) {
  return {
    vehicleVin: vehicle.vin,
    vehicleLabel: `${vehicle.modelYear} ${vehicle.make} ${vehicle.model ?? ''}`.trim(),
  }
}

export async function uploadAndExtract(
  _previous: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const user = await requireUser()
  fenceSales(user.role)

  const vehicleId = String(formData.get('vehicleId') ?? '')
  const file = formData.get('document')

  /*
    Validate before anything expensive. The size and type checks run against
    the File's own metadata, so a rejected upload never gets base64-encoded,
    never reaches object storage, and never reaches a paid API.
  */
  const check = checkUpload(file instanceof File ? file : null)
  if (!check.ok) return { status: 'ERROR', message: check.message }

  const vehicle = await loadVehicle(user.storeId, vehicleId)
  if (!vehicle) return { status: 'ERROR', message: 'That vehicle is not at this store.' }

  const gate = extractionLimiter.check(user.id, Date.now())
  if (!gate.ok) {
    return {
      status: 'ERROR',
      message: `That is a lot of documents in one hour. Try again in ${Math.ceil(
        gate.retryAfterSeconds / 60,
      )} minutes, or add the coverage by hand.`,
    }
  }

  try {
    const buffer = Buffer.from(await (file as File).arrayBuffer())
    const result = await uploadContractDocument({
      storeId: user.storeId,
      vehicleId,
      customerId: await currentOwnerId(user.storeId, vehicleId),
      uploadedByUserId: user.id,
      fileBase64: buffer.toString('base64'),
      mediaType: check.mediaType,
      context: vehicleContext(vehicle),
    })

    return {
      status: 'DRAFT',
      documentId: result.documentId,
      draft: result.draft,
      outcome: result.outcome,
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error'
    return { status: 'ERROR', message: `Could not store that document. ${detail}` }
  }
}

/**
 * Save what the advisor confirmed.
 *
 * The submitted values — not the extracted ones — are re-read through the same
 * normalisers and re-checked against the vehicle's real VIN before anything is
 * written, so the blocking rule cannot be skipped by posting straight to the
 * action.
 */
export async function saveConfirmed(
  _previous: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const user = await requireUser()
  fenceSales(user.role)

  const documentId = String(formData.get('documentId') ?? '')
  const vehicleId = String(formData.get('vehicleId') ?? '')
  const vehicle = await loadVehicle(user.storeId, vehicleId)
  if (!vehicle || !documentId) {
    return { status: 'ERROR', message: 'That upload is no longer available.' }
  }

  const submitted = readSubmittedContract((name) => {
    const raw = formData.get(name)
    if (raw === null) return null
    const value = String(raw).trim()
    return value === '' ? null : value
  })

  const recheck = reviewExtraction(submitted, vehicleContext(vehicle))
  if (!recheck.saveable) {
    return {
      status: 'ERROR',
      documentId,
      draft: recheck,
      message: recheck.issues.find((i) => i.severity === 'BLOCKING')?.message,
    }
  }

  const payload = buildConfirmedValues(submitted)
  if (!payload.ok) {
    return { status: 'ERROR', documentId, draft: recheck, message: payload.message }
  }

  await confirmContract({
    documentId,
    storeId: user.storeId,
    vehicleId,
    customerId: await currentOwnerId(user.storeId, vehicleId),
    reviewedByUserId: user.id,
    values: payload.values,
  })

  revalidatePath(`/vehicles/${vehicleId}`)
  revalidatePath('/drive')

  return {
    status: 'SAVED',
    message: 'Coverage added. It is now on this vehicle’s prep sheet.',
  }
}

export async function discardUpload(
  _previous: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const user = await requireUser()
  fenceSales(user.role)

  const documentId = String(formData.get('documentId') ?? '')
  if (!documentId) return { status: 'IDLE' }

  await rejectContractDocument({
    documentId,
    reviewedByUserId: user.id,
    reason: String(formData.get('reason') ?? 'Discarded by advisor'),
  })
  return { status: 'IDLE', message: 'Discarded. The document is kept on the vehicle record.' }
}
