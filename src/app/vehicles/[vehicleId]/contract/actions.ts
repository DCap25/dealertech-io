'use server'

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { requireUser } from '@/lib/auth/session'
import { captureContract, confirmCapture, rejectCapture } from '@/lib/contract-capture/store'
import { reviewExtraction } from '@/lib/contract-capture/review'
import type { ExtractedContract, ExtractionDraft } from '@/lib/contract-capture/types'

/** Bigger than this is a photograph of something other than one page. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic'])

export interface CaptureState {
  status: 'IDLE' | 'DRAFT' | 'ERROR' | 'SAVED'
  captureId?: string
  draft?: ExtractionDraft
  provider?: string
  message?: string
}

/**
 * The vehicle, re-read from its id.
 *
 * The VIN a draft is checked against comes from here, never from the form.
 * A client that could supply the VIN could supply one that matches the
 * document, which would defeat the only blocking check in the flow.
 */
async function loadVehicle(storeId: string, vehicleId: string) {
  const [vehicle] = await getDb()
    .select({
      id: schema.vehicles.id,
      vin: schema.vehicles.vin,
      make: schema.vehicles.make,
      model: schema.vehicles.model,
      modelYear: schema.vehicles.modelYear,
    })
    .from(schema.vehicles)
    .where(and(eq(schema.vehicles.id, vehicleId), eq(schema.vehicles.storeId, storeId)))
    .limit(1)
  return vehicle ?? null
}

async function currentOwnerId(storeId: string, vehicleId: string): Promise<string | null> {
  const [link] = await getDb()
    .select({ customerId: schema.customerVehicles.customerId })
    .from(schema.customerVehicles)
    .where(
      and(
        eq(schema.customerVehicles.storeId, storeId),
        eq(schema.customerVehicles.vehicleId, vehicleId),
        eq(schema.customerVehicles.isCurrent, true),
      ),
    )
    .limit(1)
  return link?.customerId ?? null
}

export async function extractFromPhoto(
  _previous: CaptureState,
  formData: FormData,
): Promise<CaptureState> {
  const user = await requireUser()

  const vehicleId = String(formData.get('vehicleId') ?? '')
  const file = formData.get('photo')

  if (!(file instanceof File) || file.size === 0) {
    return { status: 'ERROR', message: 'Choose a photo of the contract first.' }
  }
  if (!ALLOWED.has(file.type)) {
    return { status: 'ERROR', message: `${file.type || 'That file'} is not an image we can read.` }
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { status: 'ERROR', message: 'That image is larger than 12MB. Take it again at a lower resolution.' }
  }

  const vehicle = await loadVehicle(user.storeId, vehicleId)
  if (!vehicle) return { status: 'ERROR', message: 'That vehicle is not at this store.' }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await captureContract({
      storeId: user.storeId,
      vehicleId,
      customerId: await currentOwnerId(user.storeId, vehicleId),
      capturedByUserId: user.id,
      imageBase64: buffer.toString('base64'),
      mediaType: file.type,
      context: {
        vehicleVin: vehicle.vin,
        vehicleLabel: `${vehicle.modelYear} ${vehicle.make} ${vehicle.model ?? ''}`.trim(),
      },
    })

    return {
      status: 'DRAFT',
      captureId: result.captureId,
      draft: result.draft,
      provider: result.provider,
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error'
    return { status: 'ERROR', message: `Could not read that photo. ${detail}` }
  }
}

/**
 * Save what the advisor confirmed.
 *
 * The draft is re-checked here against the vehicle's real VIN before anything
 * is written, so the blocking rule cannot be skipped by posting straight to
 * the action.
 */
export async function saveConfirmed(
  _previous: CaptureState,
  formData: FormData,
): Promise<CaptureState> {
  const user = await requireUser()

  const captureId = String(formData.get('captureId') ?? '')
  const vehicleId = String(formData.get('vehicleId') ?? '')
  const vehicle = await loadVehicle(user.storeId, vehicleId)
  if (!vehicle || !captureId) {
    return { status: 'ERROR', message: 'That capture is no longer available.' }
  }

  const str = (k: string) => {
    const v = String(formData.get(k) ?? '').trim()
    return v === '' ? null : v
  }
  const num = (k: string) => {
    const v = str(k)
    if (v === null) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  const confirmed = {
    productType: str('productType'),
    adminCompany: str('adminCompany'),
    contractNumber: str('contractNumber'),
    purchaseDate: str('purchaseDate'),
    expirationDate: str('expirationDate'),
    termMonths: num('termMonths'),
    termMiles: num('termMiles'),
    deductibleAmount: num('deductibleAmount') ?? 0,
    vin: str('vin'),
  }

  // Re-run the same rules over what was actually submitted.
  const asExtraction = Object.fromEntries(
    Object.entries(confirmed).map(([k, v]) => [
      k,
      { value: v, confidence: 'HIGH' as const, sourceText: null },
    ]),
  ) as unknown as ExtractedContract

  const recheck = reviewExtraction(asExtraction, {
    vehicleVin: vehicle.vin,
    vehicleLabel: `${vehicle.modelYear} ${vehicle.make}`,
  })

  if (!recheck.saveable) {
    return {
      status: 'ERROR',
      captureId,
      draft: recheck,
      message: recheck.issues.find((i) => i.severity === 'BLOCKING')?.message,
    }
  }
  if (!confirmed.productType || !confirmed.adminCompany || !confirmed.purchaseDate) {
    return {
      status: 'ERROR',
      captureId,
      draft: recheck,
      message: 'Product, administrator and purchase date are needed before this can be saved.',
    }
  }

  await confirmCapture({
    captureId,
    storeId: user.storeId,
    vehicleId,
    customerId: await currentOwnerId(user.storeId, vehicleId),
    reviewedByUserId: user.id,
    values: {
      productType: confirmed.productType,
      adminCompany: confirmed.adminCompany,
      contractNumber: confirmed.contractNumber,
      purchaseDate: confirmed.purchaseDate,
      expirationDate: confirmed.expirationDate,
      termMonths: confirmed.termMonths,
      termMiles: confirmed.termMiles,
      deductibleAmount: confirmed.deductibleAmount,
    },
  })

  revalidatePath(`/vehicles/${vehicleId}`)
  revalidatePath('/drive')

  return { status: 'SAVED', message: 'Coverage added. It is now on this vehicle’s prep sheet.' }
}

export async function discardCapture(
  _previous: CaptureState,
  formData: FormData,
): Promise<CaptureState> {
  const user = await requireUser()
  const captureId = String(formData.get('captureId') ?? '')
  if (!captureId) return { status: 'IDLE' }

  await rejectCapture({
    captureId,
    reviewedByUserId: user.id,
    reason: String(formData.get('reason') ?? 'Discarded by advisor'),
  })
  return { status: 'IDLE', message: 'Discarded. The photo is kept on the vehicle record.' }
}
