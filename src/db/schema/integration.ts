import {
  pgTable, uuid, text, timestamp, boolean, integer, index, unique,
} from 'drizzle-orm/pg-core'
import { stores } from './tenancy'
import { dmsVendorEnum, syncDirectionEnum, syncEntityEnum, syncStatusEnum } from './enums'

/**
 * DMS and scheduler integration.
 *
 * Vendor-agnostic on purpose: CDK (via Fortellis), Reynolds (RCI), Tekion,
 * Xtime and a plain CSV importer all sit behind the same adapter interface, so
 * adding one is configuration rather than a schema change.
 */

export const dmsConnections = pgTable(
  'dms_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),

    vendor: dmsVendorEnum('vendor').notNull(),
    displayName: text('display_name').notNull(),

    /** The store's identifier at the vendor — dealer code, store ID, tenant slug. */
    externalStoreId: text('external_store_id'),
    /**
     * Credentials are NOT stored here. This holds a reference into a secrets
     * manager; dealership data falls under the FTC Safeguards Rule and API keys
     * do not belong in an application table.
     */
    credentialRef: text('credential_ref'),

    direction: syncDirectionEnum('direction').notNull().default('PULL'),
    /** Entities this connection handles, as JSON text. */
    enabledEntities: text('enabled_entities'),
    syncIntervalMinutes: integer('sync_interval_minutes').notNull().default(60),

    isActive: boolean('is_active').notNull().default(false),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastError: text('last_error'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('dms_connections_store_idx').on(t.storeId),
    index('dms_connections_active_idx').on(t.isActive, t.lastSyncAt),
  ],
)

export const syncRuns = pgTable(
  'sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id').notNull().references(() => dmsConnections.id, { onDelete: 'cascade' }),

    entity: syncEntityEnum('entity').notNull(),
    direction: syncDirectionEnum('direction').notNull(),
    status: syncStatusEnum('status').notNull().default('PENDING'),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),

    recordsRead: integer('records_read').notNull().default(0),
    recordsCreated: integer('records_created').notNull().default(0),
    recordsUpdated: integer('records_updated').notNull().default(0),
    recordsSkipped: integer('records_skipped').notNull().default(0),
    recordsFailed: integer('records_failed').notNull().default(0),

    /** Watermark for incremental pulls, so we don't re-read the whole history. */
    cursor: text('cursor'),
    errorDetail: text('error_detail'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sync_runs_connection_idx').on(t.connectionId, t.startedAt),
    index('sync_runs_store_status_idx').on(t.storeId, t.status),
  ],
)

/**
 * Mapping between our records and the DMS's.
 *
 * This is what makes bi-directional sync possible without duplicating rows: it
 * answers "which DMS customer is this?" and "have we already pushed this
 * appointment?" in both directions.
 */
export const externalRefs = pgTable(
  'external_refs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id').notNull().references(() => dmsConnections.id, { onDelete: 'cascade' }),

    entity: syncEntityEnum('entity').notNull(),
    /** Our row id. Deliberately untyped — it points at whichever table `entity` names. */
    internalId: uuid('internal_id').notNull(),
    externalId: text('external_id').notNull(),

    /** Hash of the last payload we saw, so unchanged records cost nothing. */
    lastPayloadHash: text('last_payload_hash'),
    lastPulledAt: timestamp('last_pulled_at', { withTimezone: true }),
    lastPushedAt: timestamp('last_pushed_at', { withTimezone: true }),

    /** Set when both sides changed since the last sync and a human must decide. */
    hasConflict: boolean('has_conflict').notNull().default(false),
    conflictDetail: text('conflict_detail'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('external_refs_external_unique').on(t.connectionId, t.entity, t.externalId),
    unique('external_refs_internal_unique').on(t.connectionId, t.entity, t.internalId),
    index('external_refs_internal_idx').on(t.entity, t.internalId),
    index('external_refs_conflict_idx').on(t.storeId, t.hasConflict),
  ],
)

/**
 * Staging table for CSV onboarding.
 *
 * Cold start is the launch risk: prep sheets and follow-up are worthless
 * without history, so importing a store's existing service history and
 * declined services is critical path, not a convenience.
 */
export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),

    entity: syncEntityEnum('entity').notNull(),
    fileName: text('file_name').notNull(),
    fileUrl: text('file_url'),
    /** User-defined mapping from CSV headers to our fields, as JSON text. */
    columnMapping: text('column_mapping'),

    status: syncStatusEnum('status').notNull().default('PENDING'),
    totalRows: integer('total_rows').notNull().default(0),
    processedRows: integer('processed_rows').notNull().default(0),
    failedRows: integer('failed_rows').notNull().default(0),
    errorReport: text('error_report'),

    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('import_batches_store_idx').on(t.storeId, t.createdAt)],
)
