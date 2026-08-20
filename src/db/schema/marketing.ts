import { pgTable, uuid, text, timestamp, integer, boolean, index, unique } from 'drizzle-orm/pg-core'
import { users } from './tenancy'

/**
 * Public-site lead capture.
 *
 * Deliberately NOT store-scoped — these arrive before a tenant exists, so
 * they sit outside the row-level-security model and are only ever read by
 * service-role code.
 */
export const demoRequests = pgTable(
  'demo_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    dealershipName: text('dealership_name').notNull(),
    role: text('role'),
    /** Rooftops in the group — the single best qualifier we can ask for. */
    rooftops: integer('rooftops'),
    dms: text('dms'),
    message: text('message'),

    /** Attribution, captured without cookies or third-party scripts. */
    source: text('source'),
    referrer: text('referrer'),

    contacted: boolean('contacted').notNull().default(false),
    contactedAt: timestamp('contacted_at', { withTimezone: true }),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('demo_requests_created_idx').on(t.createdAt),
    index('demo_requests_email_idx').on(t.email),
  ],
)

/**
 * Access codes for a gated demo tour.
 *
 * Pre-tenant like the leads above, and for the same reason: a code is issued to
 * somebody who has booked a walkthrough, which is a conversation that happens
 * before a dealership exists. Read only by platform staff; every write goes
 * through the privileged connection (migration 0033 says which path and why).
 *
 * A bearer credential — whoever holds the code takes the tour — so only its
 * SHA-256 is kept and the raw value is shown exactly once, the same discipline
 * as `storeInvitations.tokenHash`. See `src/lib/demo-tour/codes.ts`.
 */
export const demoTourCodes = pgTable(
  'demo_tour_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Usually a lead. Null for a code handed out at a conference. */
    demoRequestId: uuid('demo_request_id').references(() => demoRequests.id, {
      onDelete: 'set null',
    }),

    /** Who it was issued to, in words. Free text beats an enum here. */
    label: text('label').notNull(),
    codeHash: text('code_hash').notNull(),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    /** Withdrawn, never deleted — the question is who could see the product when. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: uuid('revoked_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),

    /**
     * Redemptions across every role.
     *
     * The per-redemption detail lives in `audit_log` under
     * `DEMO_TOUR_REDEEMED`, which is append-only by migration 0020 — a second
     * table here would have been the same shape with weaker guarantees.
     */
    uses: integer('uses').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('demo_tour_codes_hash_unique').on(t.codeHash),
    index('demo_tour_codes_created_idx').on(t.createdAt),
    index('demo_tour_codes_lead_idx').on(t.demoRequestId),
  ],
)
