import {
  pgTable, uuid, text, timestamp, boolean, integer, numeric, date, index, unique,
} from 'drizzle-orm/pg-core'
import { stores, users } from './tenancy'
import { customers, vehicles } from './customers'
import { repairOrders } from './service'
import {
  confidenceEnum, contractSourceEnum, contractStatusEnum, deductibleTypeEnum,
  productTypeEnum, tierTypeEnum,
} from './enums'

/**
 * F&I products carried into the service drive.
 *
 * The store sold the VSC, earned the reserve, and then historically lost track
 * of it — so it eats goodwill on a repair the contract would have paid. These
 * tables are what stop that.
 */

/** Reusable template per administrator and product, so entry is a few fields. */
export const contractProducts = pgTable(
  'contract_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null store means a shared catalogue entry available to every tenant. */
    storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }),

    adminCompany: text('admin_company').notNull(),
    productType: productTypeEnum('product_type').notNull(),
    productName: text('product_name').notNull(),
    tierType: tierTypeEnum('tier_type').notNull().default('EXCLUSIONARY'),

    /** Claim handling — what the advisor needs on the phone, in one place. */
    claimPhone: text('claim_phone'),
    claimPortalUrl: text('claim_portal_url'),
    claimProcedureNotes: text('claim_procedure_notes'),
    /** Starting work before authorisation is the top reason valid claims are denied. */
    requiresPriorAuthorization: boolean('requires_prior_authorization').notNull().default(true),

    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('contract_products_admin_idx').on(t.adminCompany, t.productType),
    index('contract_products_store_idx').on(t.storeId),
  ],
)

export const contracts = pgTable(
  'contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    productId: uuid('product_id').references(() => contractProducts.id, { onDelete: 'set null' }),

    productType: productTypeEnum('product_type').notNull(),
    adminCompany: text('admin_company').notNull(),
    contractNumber: text('contract_number'),
    coverageTier: text('coverage_tier'),
    tierType: tierTypeEnum('tier_type').notNull().default('EXCLUSIONARY'),

    purchaseDate: date('purchase_date').notNull(),
    purchaseMileage: integer('purchase_mileage'),
    termMonths: integer('term_months'),
    termMiles: integer('term_miles'),
    expirationDate: date('expiration_date'),
    /** Absolute odometer limit, when the contract states one. */
    expirationMiles: integer('expiration_miles'),

    deductibleAmount: numeric('deductible_amount', { precision: 10, scale: 2 }).notNull().default('0'),
    deductibleType: deductibleTypeEnum('deductible_type').notNull().default('PER_VISIT'),

    /** Tire & wheel policies usually require tread above a floor, often 3/32". */
    minimumTreadDepth32nds: integer('minimum_tread_depth_32nds'),
    perTireLimit: numeric('per_tire_limit', { precision: 10, scale: 2 }),

    status: contractStatusEnum('status').notNull().default('ACTIVE'),

    /**
     * Claim handling, denormalised from the product template.
     *
     * Carried on the instance because a contract imported from a CSV or read
     * out of a PDF often has no matching template, and the advisor still needs
     * to know whether to call for authorisation before teardown.
     */
    requiresPriorAuthorization: boolean('requires_prior_authorization').notNull().default(true),
    claimPhone: text('claim_phone'),
    claimPortalUrl: text('claim_portal_url'),

    /**
     * Provenance. An AI-extracted contract that no human has confirmed must
     * never drive a confident coverage answer, so the engine degrades on these.
     */
    source: contractSourceEnum('source').notNull().default('MANUAL'),
    extractionConfidence: confidenceEnum('extraction_confidence'),
    documentUrl: text('document_url'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedByUserId: uuid('verified_by_user_id').references(() => users.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('contracts_vehicle_idx').on(t.vehicleId),
    index('contracts_store_status_idx').on(t.storeId, t.status),
    index('contracts_customer_idx').on(t.customerId),
    index('contracts_unverified_idx').on(t.storeId, t.verifiedAt),
  ],
)

/**
 * Per-component coverage.
 *
 * On an EXCLUSIONARY contract these rows are exclusions; on an INCLUSIONARY one
 * they are the named covered components. Reading it the wrong way round is how
 * a store eats a transmission.
 */
export const contractCoverageItems = pgTable(
  'contract_coverage_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    contractId: uuid('contract_id').notNull().references(() => contracts.id, { onDelete: 'cascade' }),

    componentGroupKey: text('component_group_key').notNull(),
    /** True = covered (inclusionary listing). False = excluded (exclusionary listing). */
    isCovered: boolean('is_covered').notNull(),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('contract_coverage_unique').on(t.contractId, t.componentGroupKey),
    index('contract_coverage_contract_idx').on(t.contractId),
  ],
)

/**
 * Prepaid maintenance balance.
 *
 * Use-it-or-lose-it, which makes it the cheapest lever in the business for
 * forcing a visit that turns into an upsell.
 */
export const prepaidEntitlements = pgTable(
  'prepaid_entitlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    contractId: uuid('contract_id').notNull().references(() => contracts.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),

    componentGroupKey: text('component_group_key').notNull(),
    label: text('label').notNull(),
    totalAllowed: integer('total_allowed').notNull(),
    used: integer('used').notNull().default(0),
    expiresOn: date('expires_on'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('prepaid_entitlements_vehicle_idx').on(t.vehicleId),
    index('prepaid_entitlements_expiring_idx').on(t.storeId, t.expiresOn),
  ],
)

export const prepaidRedemptions = pgTable(
  'prepaid_redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    entitlementId: uuid('entitlement_id').notNull().references(() => prepaidEntitlements.id, { onDelete: 'cascade' }),
    repairOrderId: uuid('repair_order_id').references(() => repairOrders.id, { onDelete: 'set null' }),

    redeemedAt: timestamp('redeemed_at', { withTimezone: true }).notNull().defaultNow(),
    mileage: integer('mileage'),
    amount: numeric('amount', { precision: 10, scale: 2 }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('prepaid_redemptions_entitlement_idx').on(t.entitlementId)],
)

/** Candidate recalls per vehicle, with the verification caveat carried in data. */
export const vehicleRecalls = pgTable(
  'vehicle_recalls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),

    campaignNumber: text('campaign_number').notNull(),
    component: text('component'),
    componentGroupKeys: text('component_group_keys'),
    summary: text('summary'),
    remedy: text('remedy'),
    parkIt: boolean('park_it').notNull().default(false),
    parkOutside: boolean('park_outside').notNull().default(false),

    /**
     * TRUE means this came from an NHTSA make/model/year lookup, not a VIN-level
     * remedy check. There is no free VIN-level open-recall API, so this is the
     * normal case and the UI must never claim certainty about it.
     */
    isCandidate: boolean('is_candidate').notNull().default(true),
    /** Set once someone confirms status in the OEM portal. */
    verifiedOpenAt: timestamp('verified_open_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('vehicle_recalls_unique').on(t.vehicleId, t.campaignNumber),
    index('vehicle_recalls_vehicle_idx').on(t.vehicleId),
    index('vehicle_recalls_open_idx').on(t.storeId, t.completedAt),
  ],
)
