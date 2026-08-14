import { pgEnum, pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { stores, users } from './tenancy'
import { customers, vehicles } from './customers'
import { contracts } from './coverage'

/**
 * Photographed customer documents, and what a model read off them.
 *
 * ---------------------------------------------------------------------------
 * WHY THREE COLUMNS AND NOT ONE
 * ---------------------------------------------------------------------------
 * `rawExtraction` is what the model returned. `confirmedValues` is what the
 * advisor agreed to. They are stored separately and never merged.
 *
 * The day this matters is the day a customer is told a repair is covered and
 * the administrator declines it. The question then is whether the model misread
 * the document or a person mis-confirmed it, and that question is unanswerable
 * if the two were written into the same column. Keeping them apart also means
 * the extraction quality can be measured after the fact against what humans
 * corrected — which is the only honest way to know whether it is good enough.
 *
 * ---------------------------------------------------------------------------
 * THIS IS CUSTOMER PII
 * ---------------------------------------------------------------------------
 * A photographed contract carries a name, a VIN, and often an address and a
 * signature. Dealerships are covered financial institutions under the FTC
 * Safeguards Rule, so: the image never lands in the database, only a key to
 * object storage; access goes through the same session check as everything
 * else; and `deletedAt` exists so a deletion request can actually be honoured
 * without destroying the audit trail of the coverage decision.
 */

export const documentKindEnum = pgEnum('document_kind', [
  'SERVICE_CONTRACT',
])

export const documentCaptureStatusEnum = pgEnum('document_capture_status', [
  /** Extracted, waiting for an advisor to check it against the paper. */
  'PENDING_REVIEW',
  /** Confirmed. A contract row now exists and the coverage engine can see it. */
  'CONFIRMED',
  /** Looked at and rejected — wrong document, unreadable, not ours. */
  'REJECTED',
])

export const documentCaptures = pgTable(
  'document_captures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),

    kind: documentKindEnum('kind').notNull().default('SERVICE_CONTRACT'),
    status: documentCaptureStatusEnum('status').notNull().default('PENDING_REVIEW'),

    /**
     * Key into object storage. Never the bytes — a customer's document does
     * not belong in a row that gets copied into every backup and every
     * developer's local database.
     */
    storageKey: text('storage_key').notNull(),
    mediaType: text('media_type').notNull(),

    /** Verbatim model output, never edited. */
    rawExtraction: jsonb('raw_extraction'),
    /** What the advisor agreed to, after checking. */
    confirmedValues: jsonb('confirmed_values'),

    /** Which model read it, so a bad batch can be found later. */
    extractionProvider: text('extraction_provider'),
    extractionModel: text('extraction_model'),

    /** Set once confirmed. This is the link from a document to live coverage. */
    contractId: uuid('contract_id').references(() => contracts.id, { onDelete: 'set null' }),

    capturedByUserId: uuid('captured_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Why it was rejected, in the advisor's words. */
    reviewNotes: text('review_notes'),

    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /** Soft delete, so honouring a deletion request does not erase the audit trail. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('document_captures_vehicle_idx').on(t.vehicleId, t.status),
    index('document_captures_queue_idx').on(t.storeId, t.status, t.capturedAt),
  ],
)
