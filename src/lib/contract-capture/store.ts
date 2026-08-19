import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope } from '@/db/scoped'
import { recordAudit } from '@/lib/audit/record'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { emptyExtraction, reviewExtraction } from './review'
import { getExtractionProvider } from './provider'
import type { AcceptedMediaType } from './upload'
import type { ConfirmedContractValues } from './confirm'
import type {
  ExtractedContract, ExtractionContext, ExtractionDraft, ExtractionOutcome,
} from './types'

/**
 * Upload, extraction and confirmation.
 *
 * The document goes to object storage and the row keeps only a key. A
 * customer's contract carries their name, VIN and often a signature, and none
 * of that belongs in a table that gets copied into every backup and every
 * developer's local database.
 */

const BUCKET = 'customer-documents'

export interface UploadResult {
  documentId: string
  draft: ExtractionDraft
  outcome: ExtractionOutcome
  /** Null when nothing read the document. */
  provider: string | null
}

/**
 * Document in, reviewable draft out.
 *
 * The row is written before the model is called and updated after, so a failed
 * or slow extraction still leaves the document attached to the vehicle rather
 * than losing it. An advisor who has already uploaded a file should never have
 * to find it again.
 */
export async function uploadContractDocument(input: {
  storeId: string
  vehicleId: string
  customerId: string | null
  uploadedByUserId: string
  fileBase64: string
  mediaType: AcceptedMediaType
  context: ExtractionContext
}): Promise<UploadResult> {
  const supabase = getSupabaseAdminClient()

  const storageKey = `${input.storeId}/${input.vehicleId}/${randomUUID()}`
  const bytes = Buffer.from(input.fileBase64, 'base64')

  const upload = await supabase.storage
    .from(BUCKET)
    .upload(storageKey, bytes, { contentType: input.mediaType, upsert: false })
  if (upload.error) throw new Error(`Could not store the document: ${upload.error.message}`)

  /*
    Two separate scopes on purpose, and no transaction spanning them.

    A model call sits between the insert and the update below, and it takes
    seconds. Holding a transaction — and with it the single pooled connection —
    open across a network round trip to a third party is how one slow provider
    stalls every other request on the instance. The row is written
    PENDING_REVIEW first precisely so a failure in between leaves a document a
    human can still see and act on, rather than nothing at all.
  */
  const [row] = await withCurrentUserScope((db) => db
    .insert(schema.documentCaptures)
    .values({
      storeId: input.storeId,
      vehicleId: input.vehicleId,
      customerId: input.customerId,
      capturedByUserId: input.uploadedByUserId,
      storageKey,
      mediaType: input.mediaType,
      status: 'PENDING_REVIEW',
    })
    .returning({ id: schema.documentCaptures.id }))

  const documentId = row!.id

  const provider = await getExtractionProvider()

  /*
    No provider is not an error and is not hidden. The document is filed, the
    advisor is told plainly that nothing read it, and they type the fields.
    Nothing here invents a value to fill the gap — see ./provider.ts.
  */
  if (!provider) {
    return {
      documentId,
      draft: reviewExtraction(emptyExtraction(), input.context),
      outcome: 'NO_PROVIDER',
      provider: null,
    }
  }

  let extraction: ExtractedContract
  let outcome: ExtractionOutcome = 'EXTRACTED'
  try {
    extraction = await provider.extract({
      fileBase64: input.fileBase64,
      mediaType: input.mediaType,
      context: input.context,
    })
  } catch {
    // A failed read is not a failed upload. The advisor gets an empty form
    // with the document already attached and types the fields themselves.
    extraction = emptyExtraction()
    outcome = 'FAILED'
  }

  await withCurrentUserScope((db) => db
    .update(schema.documentCaptures)
    .set({
      rawExtraction: extraction,
      extractionProvider: provider.name,
      extractionModel: provider.model,
    })
    .where(eq(schema.documentCaptures.id, documentId)))

  return {
    documentId,
    draft: reviewExtraction(extraction, input.context),
    outcome,
    provider: provider.name,
  }
}

/**
 * The advisor has checked every field against the document and agreed to it.
 *
 * This is the only path by which an extraction reaches the coverage engine.
 *
 * ---------------------------------------------------------------------------
 * WHY `verifiedAt` STAYS NULL
 * ---------------------------------------------------------------------------
 * It would be easy to read the advisor's confirmation as verification and
 * clear the engine's low-confidence penalty here. That would be wrong, and the
 * distinction is the whole of PROJECT_OVERVIEW §2 applied to ingestion.
 *
 * What the advisor did was agree that the transcription matches the paper in
 * their hand. That is a real check and it is why nothing saves without it. But
 * it is not the question the engine's penalty is asking, which is: does this
 * policy exist, is it in force, and will the administrator pay? A contract can
 * be transcribed perfectly and still be cancelled, lapsed for non-payment,
 * void on a salvage title, or simply not the copy the administrator holds.
 * Only the administrator can answer that, and until somebody has rung them,
 * "a human read the document" is the honest ceiling.
 *
 * So `source` stays machine-read, `verifiedAt` stays null, and the engine keeps
 * saying "read from a document and not yet verified — confirm the terms before
 * relying on them" on every determination it drives. We advise; we do not
 * adjudicate. Verification is a separate act by a separate party, and the
 * column exists to record it when it happens rather than to be filled in by
 * the nearest available person.
 */
export async function confirmContract(input: {
  documentId: string
  storeId: string
  vehicleId: string
  customerId: string | null
  reviewedByUserId: string
  values: ConfirmedContractValues
}): Promise<{ contractId: string }> {
  const now = new Date()
  const { values } = input

  /*
    The contract and the document that produced it, together. A contract with
    no document marked CONFIRMED leaves the upload sitting in the review queue
    for somebody to approve a second time; a document marked CONFIRMED with no
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

        productType: values.productType,
        adminCompany: values.adminCompany,
        contractNumber: values.contractNumber,
        coverageTier: values.coverageTier,
        tierType: values.tierType,

        purchaseDate: values.purchaseDate,
        purchaseMileage: values.purchaseMileage,
        expirationDate: values.expirationDate,
        expirationMiles: values.expirationMiles,
        termMonths: values.termMonths,
        termMiles: values.termMiles,

        deductibleAmount: String(values.deductibleAmount),
        deductibleType: values.deductibleType,

        requiresPriorAuthorization: values.requiresPriorAuthorization,

        status: 'ACTIVE',
        // Requires migration 0031. See the note at the top of that file.
        source: 'AI_EXTRACTION',
        // Not an oversight — see the block comment above.
        verifiedAt: null,
      })
      .returning({ id: schema.contracts.id })

    const contractId = contract!.id

    await db
      .update(schema.documentCaptures)
      .set({
        status: 'CONFIRMED',
        confirmedValues: values,
        contractId,
        reviewedByUserId: input.reviewedByUserId,
        reviewedAt: now,
      })
      .where(eq(schema.documentCaptures.id, input.documentId))

    /*
      Coverage arriving from an uploaded document, confirmed by a person.

      This is the entry that matters most in this file: from here on the
      coverage engine will answer on this vehicle partly on the strength of
      fields somebody read off a document and accepted. If a customer is later
      told a repair is covered and the administrator disagrees, this row is who
      accepted what, and when.
    */
    await recordAudit(db, {
      action: 'CONTRACT_CONFIRMED',
      entityType: 'contracts',
      entityId: contractId,
      storeId: input.storeId,
      userId: input.reviewedByUserId,
      changes: {
        documentId: input.documentId,
        vehicleId: input.vehicleId,
        adminCompany: values.adminCompany,
        productType: values.productType,
        contractNumber: values.contractNumber,
        coverageTier: values.coverageTier,
        tierType: values.tierType,
        expirationDate: values.expirationDate,
        termMonths: values.termMonths,
        termMiles: values.termMiles,
        deductibleAmount: values.deductibleAmount,
      },
    })

    return { contractId }
  })
}

export async function rejectContractDocument(input: {
  documentId: string
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
    .where(eq(schema.documentCaptures.id, input.documentId)))
}

/** Uploads still waiting on a human, newest first. */
export async function pendingDocuments(storeId: string, vehicleId: string) {
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

/** Every document filed against a vehicle, whatever became of it. */
export async function documentsForVehicle(storeId: string, vehicleId: string) {
  return withCurrentUserScope((db) => db
    .select({
      id: schema.documentCaptures.id,
      status: schema.documentCaptures.status,
      mediaType: schema.documentCaptures.mediaType,
      storageKey: schema.documentCaptures.storageKey,
      extractionProvider: schema.documentCaptures.extractionProvider,
      contractId: schema.documentCaptures.contractId,
      capturedAt: schema.documentCaptures.capturedAt,
      reviewedAt: schema.documentCaptures.reviewedAt,
    })
    .from(schema.documentCaptures)
    .where(
      and(
        eq(schema.documentCaptures.storeId, storeId),
        eq(schema.documentCaptures.vehicleId, vehicleId),
        isNull(schema.documentCaptures.deletedAt),
      ),
    )
    .orderBy(desc(schema.documentCaptures.capturedAt)))
}

/**
 * A short-lived link to the stored document, so the advisor can compare the
 * extraction against it without the bucket being public.
 */
export async function signedDocumentUrl(storageKey: string): Promise<string | null> {
  const supabase = getSupabaseAdminClient()
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(storageKey, 60 * 10)
  return data?.signedUrl ?? null
}
