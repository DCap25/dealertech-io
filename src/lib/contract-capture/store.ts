import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope } from '@/db/scoped'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { reviewExtraction } from './review'
import { getVisionProvider } from './provider'
import type { ExtractedContract, ExtractionContext, ExtractionDraft } from './types'

/**
 * Capture, extraction and confirmation.
 *
 * The image goes to object storage and the row keeps only a key. A customer's
 * contract carries their name, VIN and often a signature, and none of that
 * belongs in a table that gets copied into every backup and every developer's
 * local database.
 */

const BUCKET = 'customer-documents'

export interface CaptureResult {
  captureId: string
  draft: ExtractionDraft
  provider: string
}

/**
 * Photograph in, reviewable draft out.
 *
 * The row is written before the model is called and updated after, so a
 * failed or slow extraction still leaves the image attached to the vehicle
 * rather than losing it. An advisor who has already taken the photo should
 * never have to take it again.
 */
export async function captureContract(input: {
  storeId: string
  vehicleId: string
  customerId: string | null
  capturedByUserId: string
  imageBase64: string
  mediaType: string
  context: ExtractionContext
}): Promise<CaptureResult> {
  const supabase = getSupabaseAdminClient()

  const storageKey = `${input.storeId}/${input.vehicleId}/${randomUUID()}`
  const bytes = Buffer.from(input.imageBase64, 'base64')

  const upload = await supabase.storage
    .from(BUCKET)
    .upload(storageKey, bytes, { contentType: input.mediaType, upsert: false })
  if (upload.error) throw new Error(`Could not store the photo: ${upload.error.message}`)

  /*
    Two separate scopes on purpose, and no transaction spanning them.

    A vision-model call sits between the insert and the update below, and it
    takes seconds. Holding a transaction — and with it the single pooled
    connection — open across a network round trip to a third party is how one
    slow provider stalls every other request on the instance. The row is
    written PENDING_REVIEW first precisely so a failure in between leaves a
    capture a human can still see and act on, rather than nothing at all.
  */
  const [row] = await withCurrentUserScope((db) => db
    .insert(schema.documentCaptures)
    .values({
      storeId: input.storeId,
      vehicleId: input.vehicleId,
      customerId: input.customerId,
      capturedByUserId: input.capturedByUserId,
      storageKey,
      mediaType: input.mediaType,
      status: 'PENDING_REVIEW',
    })
    .returning({ id: schema.documentCaptures.id }))

  const captureId = row!.id

  const provider = await getVisionProvider()
  let extraction: ExtractedContract
  try {
    extraction = await provider.extract({
      imageBase64: input.imageBase64,
      mediaType: input.mediaType,
      context: input.context,
    })
  } catch {
    // A failed read is not a failed capture. The advisor gets an empty form
    // with the photo already attached and types the four fields themselves.
    const { emptyExtraction } = await import('./review')
    extraction = emptyExtraction()
  }

  await withCurrentUserScope((db) => db
    .update(schema.documentCaptures)
    .set({
      rawExtraction: extraction,
      extractionProvider: provider.name,
      extractionModel: provider.name === 'anthropic' ? 'claude-opus-5' : 'mock',
    })
    .where(eq(schema.documentCaptures.id, captureId)))

  return {
    captureId,
    draft: reviewExtraction(extraction, input.context),
    provider: provider.name,
  }
}

/**
 * The advisor has checked every field against the paper and agreed to it.
 *
 * This is the only path by which an extraction reaches the coverage engine.
 * `verifiedAt` is what clears the engine's low-confidence penalty on a
 * machine-read contract — the source stays PHOTO_EXTRACTION so the provenance
 * survives, rather than being laundered into MANUAL.
 */
export async function confirmCapture(input: {
  captureId: string
  storeId: string
  vehicleId: string
  customerId: string | null
  reviewedByUserId: string
  values: {
    productType: string
    adminCompany: string
    contractNumber: string | null
    purchaseDate: string
    expirationDate: string | null
    termMonths: number | null
    termMiles: number | null
    deductibleAmount: number
  }
}): Promise<{ contractId: string }> {
  const now = new Date()

  /*
    The contract and the capture that produced it, together. A contract with no
    capture marked CONFIRMED leaves the photo sitting in the review queue for
    somebody to approve a second time; a capture marked CONFIRMED with no
    contract loses the coverage entirely, which is worse — every coverage
    answer for that vehicle from then on is wrong in the customer's disfavour.
  */
  return withCurrentUserScope(async (db) => {
  const [contract] = await db
    .insert(schema.contracts)
    .values({
      storeId: input.storeId,
      vehicleId: input.vehicleId,
      customerId: input.customerId,
      productType: input.values.productType as 'VSC',
      adminCompany: input.values.adminCompany,
      contractNumber: input.values.contractNumber,
      purchaseDate: input.values.purchaseDate,
      expirationDate: input.values.expirationDate,
      termMonths: input.values.termMonths,
      termMiles: input.values.termMiles,
      deductibleAmount: String(input.values.deductibleAmount),
      deductibleType: input.values.deductibleAmount > 0 ? 'PER_VISIT' : 'NONE',
      status: 'ACTIVE',
      source: 'PHOTO_EXTRACTION',
      verifiedAt: now,
    })
    .returning({ id: schema.contracts.id })

  const contractId = contract!.id

  await db
    .update(schema.documentCaptures)
    .set({
      status: 'CONFIRMED',
      confirmedValues: input.values,
      contractId,
      reviewedByUserId: input.reviewedByUserId,
      reviewedAt: now,
    })
    .where(eq(schema.documentCaptures.id, input.captureId))

  return { contractId }
  })
}

export async function rejectCapture(input: {
  captureId: string
  reviewedByUserId: string
  reason: string
}): Promise<void> {
  await withCurrentUserScope((db) => db
    .update(schema.documentCaptures)
    .set({
      status: 'REJECTED',
      reviewedByUserId: input.reviewedByUserId,
      reviewNotes: input.reason,
      reviewedAt: new Date(),
    })
    .where(eq(schema.documentCaptures.id, input.captureId)))
}

/** Captures still waiting on a human, newest first. */
export async function pendingCaptures(storeId: string, vehicleId: string) {
  return withCurrentUserScope((db) => db
    .select()
    .from(schema.documentCaptures)
    .where(
      and(
        eq(schema.documentCaptures.storeId, storeId),
        eq(schema.documentCaptures.vehicleId, vehicleId),
        eq(schema.documentCaptures.status, 'PENDING_REVIEW'),
        isNull(schema.documentCaptures.deletedAt),
      ),
    )
    .orderBy(desc(schema.documentCaptures.capturedAt)))
}

/**
 * A short-lived link to the stored image, so the advisor can compare the
 * extraction against the document without the bucket being public.
 */
export async function signedImageUrl(storageKey: string): Promise<string | null> {
  const supabase = getSupabaseAdminClient()
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(storageKey, 60 * 10)
  return data?.signedUrl ?? null
}
