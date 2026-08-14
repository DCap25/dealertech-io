import { pgEnum, pgTable, uuid, text, timestamp, jsonb, index, unique } from 'drizzle-orm/pg-core'
import { stores, users } from './tenancy'
import { appointments } from './service'

/**
 * Customer-facing tablets, and what is currently on them.
 *
 * The threat model is a device on a bench in a service drive: unattended most
 * of its life, handed to strangers, and eventually dropped, stolen or taken
 * home by accident. Everything here assumes the device is lost.
 *
 * A tablet holds a bearer token and can do exactly two things with it: read
 * the presentation currently pushed to it, and post decisions back against
 * that presentation. It cannot query. There is no endpoint that takes a
 * customer id, an appointment id or a search term from a device.
 */

export const pairedDeviceStatusEnum = pgEnum('paired_device_status', [
  /** Code issued, waiting for an advisor to claim it. */
  'AWAITING_PAIRING',
  'PAIRED',
  'REVOKED',
])

export const pairedDevices = pgTable(
  'paired_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null until an advisor claims it — an unpaired tablet belongs to nobody. */
    storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }),

    /** What the advisor calls it. "Lane 3", "Waiting room". */
    name: text('name'),
    status: pairedDeviceStatusEnum('status').notNull().default('AWAITING_PAIRING'),

    /** Short, human-typed, single use, expires in ten minutes. */
    pairingCode: text('pairing_code'),
    pairingExpiresAt: timestamp('pairing_expires_at', { withTimezone: true }),

    /**
     * SHA-256 of the device's bearer token, never the token. A dump of this
     * table must not let anyone impersonate a tablet.
     */
    tokenHash: text('token_hash').notNull(),

    pairedByUserId: uuid('paired_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    pairedAt: timestamp('paired_at', { withTimezone: true }),
    /** Updated on every poll, so a manager can see which tablets are alive. */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('paired_devices_token_hash').on(t.tokenHash),
    index('paired_devices_store_idx').on(t.storeId, t.status),
    index('paired_devices_code_idx').on(t.pairingCode),
  ],
)

export const presentationStatusEnum = pgEnum('presentation_status', ['ACTIVE', 'ENDED'])

export const presentationSessions = pgTable(
  'presentation_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').notNull().references(() => pairedDevices.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
    advisorId: uuid('advisor_id').references(() => users.id, { onDelete: 'set null' }),

    /**
     * The frozen menu the advisor approved, already stripped of everything a
     * customer must not see. The tablet renders this and nothing else — it
     * never reads a prep sheet, so a change on the advisor's screen mid
     * conversation cannot surprise the person holding the tablet.
     */
    snapshot: jsonb('snapshot').notNull(),
    /** What the customer has tapped so far. */
    decisions: jsonb('decisions').notNull().default({}),

    status: presentationStatusEnum('status').notNull().default('ACTIVE'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    /** Bumped on every customer tap, so the advisor can see they are engaged. */
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    index('presentation_sessions_device_idx').on(t.deviceId, t.status),
    index('presentation_sessions_store_idx').on(t.storeId, t.status, t.startedAt),
  ],
)
