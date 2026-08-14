import {
  pgEnum, pgTable, uuid, text, timestamp, jsonb, integer, boolean, index, uniqueIndex,
} from 'drizzle-orm/pg-core'
import { stores, users } from './tenancy'
import { appointments } from './service'

/**
 * What was pushed to the DMS, and what came back.
 *
 * The adapter has been able to push a hand-off for a while; what it could not
 * do is answer questions about it afterwards. The result lived in React state,
 * so a page reload lost it — and "did this reach the DMS?" is exactly what an
 * advisor needs to know when a customer rings about work that never got done.
 */

export const dmsHandoffStatusEnum = pgEnum('dms_handoff_status', ['SENT', 'FAILED'])

export const dmsHandoffs = pgTable(
  'dms_handoffs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
    advisorId: uuid('advisor_id').references(() => users.id, { onDelete: 'set null' }),

    /** Content hash. See idempotencyKey in src/lib/dms/handoff-record.ts. */
    idempotencyKey: text('idempotency_key').notNull(),

    /** Exactly what was sent, verbatim. */
    payload: jsonb('payload').notNull(),

    status: dmsHandoffStatusEnum('status').notNull(),
    vendor: text('vendor').notNull(),
    /** False on the mock. The UI must never claim a write that did not happen. */
    writesPersisted: boolean('writes_persisted').notNull().default(false),
    externalRef: text('external_ref'),
    message: text('message').notNull(),

    acceptedCount: integer('accepted_count').notNull().default(0),
    attempts: integer('attempts').notNull().default(1),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [
    // Scoped to the store: two dealerships can legitimately hash the same for
    // a similar visit, and they are not the same hand-off.
    uniqueIndex('dms_handoffs_idempotency').on(t.storeId, t.idempotencyKey),
    index('dms_handoffs_appointment_idx').on(t.appointmentId, t.createdAt),
    index('dms_handoffs_store_idx').on(t.storeId, t.status, t.createdAt),
  ],
)
