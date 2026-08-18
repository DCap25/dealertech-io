import {
  pgTable, uuid, text, timestamp, boolean, integer, numeric, date, index, unique,
} from 'drizzle-orm/pg-core'
import { stores, users } from './tenancy'
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

    /**
     * Their advisor — DRIVE_PLAN D6, the relationship as a fact.
     *
     * Nullable, and null is the ordinary state: most customers do not have a
     * guy, and pretending otherwise would make step 2 of the assignment
     * cascade fire on a relationship nobody formed. It is set at the two
     * moments the relationship actually forms — the delivery introduction with
     * a named advisor (`SALES_INTRO`), and the first completed visit when no
     * owner exists yet (`FIRST_VISIT`) — and **never silently reassigned by
     * traffic**. A relationship the system moves on its own is not one.
     *
     * This single column is what makes `assignAdvisor`'s owning step reachable
     * and "my customers" queryable at all.
     */
    owningAdvisorId: uuid('owning_advisor_id').references(() => users.id, { onDelete: 'set null' }),
    /** Since when. Read as "your customer since March", not as an audit row. */
    owningAdvisorSince: timestamp('owning_advisor_since', { withTimezone: true }),
    /**
     * SALES_INTRO · FIRST_VISIT · REQUESTED · MANAGER_SET — D6.
     *
     * Text rather than an enum, matching `assignment_reason` and the
     * `presentation_sessions.channel` precedent: the vocabulary is younger than
     * the table and will grow. `OwningAdvisorSource` in
     * src/lib/scheduling/owning.ts is the authority on the values.
     *
     * Only two of the four are written today. REQUESTED and MANAGER_SET wait on
     * a manager edit surface, which P3 deliberately does not build — see the
     * type for why they are named anyway.
     */
    owningAdvisorSource: text('owning_advisor_source'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('customers_store_idx').on(t.storeId),
    // "My customers", which is the query the owning relationship exists to make
    // answerable — and D4 step 2 reads one row of it per booking.
    index('customers_owning_advisor_idx').on(t.storeId, t.owningAdvisorId),
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

    /**
     * Set only when this reading went backwards and someone accepted it.
     *
     * An odometer cannot decrease, so the decision to record one that did is
     * the whole audit trail — who said it was legitimate, and why. Stored on
     * the reading rather than derived later, because the question is what the
     * advisor was looking at when they decided, not what the history says now.
     */
    previousMileage: integer('previous_mileage'),
    overrideReason: text('override_reason'),
    overrideNote: text('override_note'),
    overrideByUserId: uuid('override_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    overrideAt: timestamp('override_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('mileage_readings_vehicle_idx').on(t.vehicleId, t.recordedAt),
    index('mileage_readings_override_idx').on(t.storeId, t.overrideAt),
  ],
)
