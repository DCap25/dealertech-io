import { pgTable, uuid, text, timestamp, integer, boolean, index } from 'drizzle-orm/pg-core'

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
