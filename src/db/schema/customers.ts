import {
  pgTable, uuid, text, timestamp, boolean, integer, numeric, date, index, unique,
} from 'drizzle-orm/pg-core'
import { stores } from './tenancy'
import { contactChannelEnum } from './enums'

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),

    firstName: text('first_name'),
    lastName: text('last_name'),
    /** Populated for fleet and business customers, where person names don't apply. */
    companyName: text('company_name'),

    email: text('email'),
    mobilePhone: text('mobile_phone'),
    homePhone: text('home_phone'),
    workPhone: text('work_phone'),

    addressLine1: text('address_line1'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),

    preferredChannel: contactChannelEnum('preferred_channel').notNull().default('SMS'),
    preferredLanguage: text('preferred_language').notNull().default('en'),

    /**
     * Denormalised consent flags for fast filtering. The authoritative record is
     * the append-only consent_events table — these are a cache of it, and any
     * dispute is settled by the events, not by these columns.
     */
    smsConsent: boolean('sms_consent').notNull().default(false),
    smsMarketingConsent: boolean('sms_marketing_consent').notNull().default(false),
    emailConsent: boolean('email_consent').notNull().default(false),
    emailMarketingConsent: boolean('email_marketing_consent').notNull().default(false),
    doNotCall: boolean('do_not_call').notNull().default(false),

    /** Rolled up from repair orders. Drives goodwill and loyalty decisions. */
    lifetimeSpend: numeric('lifetime_spend', { precision: 12, scale: 2 }).notNull().default('0'),
    visitCount: integer('visit_count').notNull().default(0),
    firstVisitAt: timestamp('first_visit_at', { withTimezone: true }),
    lastVisitAt: timestamp('last_visit_at', { withTimezone: true }),
    /** Most recent manufacturer survey score, when known. Flags CSI risk at write-up. */
    lastCsiScore: integer('last_csi_score'),

    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('customers_store_idx').on(t.storeId),
    index('customers_store_lastname_idx').on(t.storeId, t.lastName),
    index('customers_store_mobile_idx').on(t.storeId, t.mobilePhone),
    index('customers_store_email_idx').on(t.storeId, t.email),
    index('customers_last_visit_idx').on(t.storeId, t.lastVisitAt),
  ],
)

export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),

    vin: text('vin').notNull(),
    /** Whether the VIN passed ISO 3779 check-digit validation. */
    vinValid: boolean('vin_valid').notNull().default(false),

    make: text('make').notNull(),
    model: text('model'),
    modelYear: integer('model_year').notNull(),
    trim: text('trim'),
    bodyClass: text('body_class'),
    driveType: text('drive_type'),
    engineDescription: text('engine_description'),
    fuelType: text('fuel_type'),
    /** Derived from the VIN decode. Drives hybrid/EV and CARB warranty terms. */
    isHybridOrEv: boolean('is_hybrid_or_ev').notNull().default(false),

    color: text('color'),
    licensePlate: text('license_plate'),
    licenseState: text('license_state'),

    /**
     * Warranty clocks run from in-service date, NOT build or purchase date.
     * Getting this wrong shifts every coverage decision.
     */
    inServiceDate: date('in_service_date'),

    currentMileage: integer('current_mileage'),
    mileageAsOf: timestamp('mileage_as_of', { withTimezone: true }),
    /**
     * Observed average, computed from mileage history. Used to project the
     * odometer forward to an appointment date so maintenance-due is accurate
     * rather than based on a stale last-known reading.
     */
    avgMilesPerDay: numeric('avg_miles_per_day', { precision: 8, scale: 2 }),

    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('vehicles_store_vin_unique').on(t.storeId, t.vin),
    index('vehicles_store_idx').on(t.storeId),
    index('vehicles_vin_idx').on(t.vin),
    index('vehicles_make_year_idx').on(t.make, t.modelYear),
  ],
)

/**
 * Ownership link, kept as history rather than a column on `vehicles`.
 *
 * Whether the customer is the ORIGINAL owner is decisive on Hyundai, Kia,
 * Genesis and Mitsubishi, where the headline 10yr/100k powertrain term applies
 * only to the first retail purchaser.
 */
export const customerVehicles = pgTable(
  'customer_vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),

    isOriginalOwner: boolean('is_original_owner').notNull().default(false),
    /** True when this store sold the vehicle — drives loyalty and goodwill leverage. */
    soldByStore: boolean('sold_by_store').notNull().default(false),
    purchasedAt: date('purchased_at'),

    isCurrent: boolean('is_current').notNull().default(true),
    relinquishedAt: timestamp('relinquished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('customer_vehicles_customer_idx').on(t.customerId),
    index('customer_vehicles_vehicle_idx').on(t.vehicleId),
    index('customer_vehicles_store_current_idx').on(t.storeId, t.isCurrent),
  ],
)

/**
 * Odometer readings over time. Two points give a wear rate; three give a
 * defensible projection. This is what turns tire and brake sales from reactive
 * into scheduled.
 */
export const mileageReadings = pgTable(
  'mileage_readings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
    mileage: integer('mileage').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    source: text('source').notNull().default('MANUAL'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('mileage_readings_vehicle_idx').on(t.vehicleId, t.recordedAt)],
)
