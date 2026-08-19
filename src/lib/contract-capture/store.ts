import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { schema } from '@/db/client'
import { withCurrentUserScope } from '@/db/scoped'
import { recordAudit } from '@/lib/audit/record'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { emptyExtraction, reviewExtraction } from './review'
import { getExtractionProvider } from './provider'
import { checkUpload } from './upload'
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

  /*
    Re-check the file against its own bytes, not the caller's word for them.

    `uploadAndExtract` runs `checkUpload` against the File's metadata before it
    encodes anything, which is the right place for it — a rejection there costs
    nothing. But this function is exported, and its only guard on the media
    type is the compiler, which is not present at runtime and says nothing at
    all about size. A second caller that skipped the check would put an
    oversized document into storage and then spend a paid call on it.

    The decoded length is exact rather than an estimate, and it is already in
    hand for the upload, so the check is a comparison rather than any real
    work. Throwing rather than returning a rejection: this is the impossible
    branch for the one caller that exists today, not a message for an advisor.
  */
  const recheck = checkUpload({ type: input.mediaType, size: bytes.byteLength })
  if (!recheck.ok) throw new Error(`That document cannot be uploaded. ${recheck.message}`)

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
    /*
      Still a write, even though nothing was read.

      This branch returns before the update below, so it used to leave the row
      saying nothing at all — no provider, no model, no outcome — which reads
      exactly like a row whose extraction is still in flight. The distinction
      the outcome column exists to preserve is lost at precisely the moment it
      is cheapest to record. One column, its own scope, the same
      no-transaction-across-a-network-call rule as everything else here.
    */
    await withCurrentUserScope((db) => db
      .update(schema.documentCaptures)
      .set({ extractionOutcome: 'NO_PROVIDER' })
      .where(eq(schema.documentCaptures.id, documentId)))

    return {
      documentId,
      draft: reviewExtraction(emptyExtraction(), input.context),
      outcome: 'NO_PROVIDER',
      provider: null,
    }
  }

  let extraction: ExtractedContract | null
  let outcome: ExtractionOutcome = 'EXTRACTED'
  try {
    extraction = await provider.extract({
      fileBase64: input.fileBase64,
      mediaType: input.mediaType,
      context: input.context,
    })
  } catch {
    /*
      A failed read is not a failed upload — the advisor gets an empty form
      with the document already attached and types the fields themselves.

      Null, not `emptyExtraction()`. The blank object was a lie: it stored a
      call that threw as though a model had read the document and found
      fifteen empty fields, which is a real and different answer. The empty
      form below is built fresh for the screen; the row records that nothing
      came back.
    */
    extraction = null
    outcome = 'FAILED'
  }

  await withCurrentUserScope((db) => db
    .update(schema.documentCaptures)
    .set({
      rawExtraction: extraction,
      extractionOutcome: outcome,
      extractionProvider: provider.name,
      extractionModel: provider.model,
    })
    .where(eq(schema.documentCaptures.id, documentId)))

  return {
    documentId,
    draft: reviewExtraction(extraction ?? emptyExtraction(), input.context),
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
    /*
      Claim the document before writing anything, and let the WHERE do it.

      A server action is a public endpoint and a form can be submitted twice —
      a double tap, a retried request, a back button. The insert used to come
      first and the update carried no condition beyond the id, so the second
      submission cheerfully inserted a *second* ACTIVE contract for the same
      vehicle and re-stamped the same document over it. Two live policies from
      one piece of paper is not a duplicate row; it is the coverage engine
      arbitrating between two versions of the truth.

      Every check that matters is in this one statement, so the database
      decides rather than a read-then-write that another request can slip
      between: the document must exist, still be awaiting review, not have been
      deleted, and actually belong to the store and vehicle that were posted.
      Exactly one caller gets a row back. The rest throw before the insert, and
      the transaction they are in unwinds with nothing written.
    */
    const [claimed] = await db
      .update(schema.documentCaptures)
      .set({
        status: 'CONFIRMED',
        confirmedValues: values,
        reviewedByUserId: input.reviewedByUserId,
        reviewedAt: now,
      })
      .where(
        and(
          eq(schema.documentCaptures.id, input.documentId),
          eq(schema.documentCaptures.storeId, input.storeId),
          eq(schema.documentCaptures.vehicleId, input.vehicleId),
          eq(schema.documentCaptures.status, 'PENDING_REVIEW'),
          isNull(schema.documentCaptures.deletedAt),
        ),
      )
      .returning({ id: schema.documentCaptures.id })

    if (!claimed) {
      throw new Error(
        'That upload is no longer waiting for review — it has already been confirmed or ' +
          'discarded, or it belongs to a different vehicle. Reload the vehicle to see its ' +
          'current coverage before adding it again.',
      )
    }

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

    /*
      The second half of the claim: point the document at the contract it
      produced. Safe to key on the id alone now — this transaction owns the row,
      and no other caller can have claimed it since the update above.
    */
    await db
      .update(schema.documentCaptures)
      .set({ contractId })
      .where(eq(schema.documentCaptures.id, claimed.id))

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

/**
 * Throw the upload away.
 *
 * Returns false when there was nothing to discard, rather than throwing —
 * see `discardUpload` for why the caller wants a fact instead of an error.
 */
export async function rejectContractDocument(input: {
  documentId: string
  reviewedByUserId: string
  reason: string
}): Promise<boolean> {
  /*
    Claim the document, exactly as `confirmContract` does, and for the same
    reason in reverse: a discard posted after a confirm used to key on the id
    alone and would happily stamp REJECTED over a CONFIRMED row — while the
    contract it produced stayed ACTIVE. The document then says the advisor
    threw it away and the coverage engine says it is live, and the vehicle's
    prep sheet believes the engine. A CONFIRMED document must never become
    REJECTED; the WHERE is what guarantees that rather than an ordering
    assumption about which request lands first.
  */
  const [rejected] = await withCurrentUserScope((db) => db
    .update(schema.documentCaptures)
    .set({
      status: 'REJECTED',
      reviewedByUserId: input.reviewedByUserId,
      reviewNotes: input.reason,
      reviewedAt: new Date(),
    })
    .where(
      and(
        eq(schema.documentCaptures.id, input.documentId),
        eq(schema.documentCaptures.status, 'PENDING_REVIEW'),
        isNull(schema.documentCaptures.deletedAt),
      ),
    )
    .returning({ id: schema.documentCaptures.id }))

  return Boolean(rejected)
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
