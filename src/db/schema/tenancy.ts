import { pgTable, uuid, text, timestamp, boolean, integer, numeric, index, unique } from 'drizzle-orm/pg-core'
import { userRoleEnum } from './enums'

/**
 * Tenancy.
 *
 * Every tenant-scoped table below carries `store_id` and is protected by
 * row-level security. RLS is the isolation boundary — not application code —
 * so a missing WHERE clause can never leak another dealer's customers.
 */

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** Dealer group slug, used in URLs. */
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const stores = pgTable(
  'stores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),

    /** Franchise brand, uppercase, matching NHTSA vPIC make (e.g. "TOYOTA"). */
    franchiseMake: text('franchise_make'),

    addressLine1: text('address_line1'),
    city: text('city'),
    /** Two-letter code. Drives CARB hybrid terms and state inspection rules. */
    state: text('state'),
    postalCode: text('postal_code'),
    phone: text('phone'),
    timezone: text('timezone').notNull().default('America/Chicago'),

    /** Door rate for customer-pay labor. */
    laborRate: numeric('labor_rate', { precision: 10, scale: 2 }).notNull().default('0'),
    warrantyLaborRate: numeric('warranty_labor_rate', { precision: 10, scale: 2 }),
    /** Sales tax on parts, as a decimal fraction (0.0825 = 8.25%). */
    partsTaxRate: numeric('parts_tax_rate', { precision: 6, scale: 5 }).notNull().default('0'),
    laborTaxRate: numeric('labor_tax_rate', { precision: 6, scale: 5 }).notNull().default('0'),

    /** Quiet hours for outbound messaging, local time. TCPA safe harbour is 8am-9pm. */
    quietHoursStart: integer('quiet_hours_start').notNull().default(8),
    quietHoursEnd: integer('quiet_hours_end').notNull().default(21),

    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('stores_org_slug_unique').on(t.organizationId, t.slug),
    index('stores_org_idx').on(t.organizationId),
  ],
)

/**
 * Application user, mirroring the Supabase auth user.
 * `id` equals `auth.users.id` so RLS policies can compare directly.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  fullName: text('full_name'),
  phone: text('phone'),
  avatarUrl: text('avatar_url'),
  isActive: boolean('is_active').notNull().default(true),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * A user's role at one store. A person can advise at one rooftop and manage
 * another, so this is many-to-many rather than a column on `users`.
 */
export const userStoreRoles = pgTable(
  'user_store_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    role: userRoleEnum('role').notNull(),

    /** Advisor's DMS operator number, for matching RO ownership on import. */
    dmsOperatorCode: text('dms_operator_code'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('user_store_role_unique').on(t.userId, t.storeId, t.role),
    index('user_store_roles_store_idx').on(t.storeId),
    index('user_store_roles_user_idx').on(t.userId),
  ],
)

/**
 * Append-only access log. Required under the FTC Safeguards Rule, which treats
 * dealerships as financial institutions and expects monitored access to
 * customer information.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').references(() => stores.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    /** Field-level before/after for mutations. */
    changes: text('changes'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_store_created_idx').on(t.storeId, t.createdAt),
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
  ],
)
