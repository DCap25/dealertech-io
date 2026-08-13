import {
  pgTable, uuid, text, timestamp, boolean, integer, numeric, index, unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { stores, users } from './tenancy'
import { customers, vehicles } from './customers'
import {
  appointmentSourceEnum, appointmentStatusEnum, inspectionStatusEnum, measurementUnitEnum,
  payTypeEnum, payerEnum, roLineStatusEnum, roStatusEnum, transportTypeEnum, wheelPositionEnum,
  confidenceEnum, opportunityOutcomeEnum,
} from './enums'

/** The store's own service menu. Every store already has one; this is the source of truth. */
export const opCodes = pgTable(
  'op_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    description: text('description').notNull(),
    /** Maps into the component taxonomy so the coverage engine can arbitrate it. */
    componentGroupKey: text('component_group_key'),
    category: text('category'),
    laborHours: numeric('labor_hours', { precision: 6, scale: 2 }),
    laborAmount: numeric('labor_amount', { precision: 10, scale: 2 }),
    partsAmount: numeric('parts_amount', { precision: 10, scale: 2 }),
    isMaintenance: boolean('is_maintenance').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('op_codes_store_code_unique').on(t.storeId, t.code),
    index('op_codes_store_idx').on(t.storeId),
  ],
)

export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    advisorId: uuid('advisor_id').references(() => users.id, { onDelete: 'set null' }),

    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    /** What the customer was told, which is the number CSI is measured against. */
    promisedAt: timestamp('promised_at', { withTimezone: true }),
    estimatedMinutes: integer('estimated_minutes'),

    status: appointmentStatusEnum('status').notNull().default('SCHEDULED'),
    source: appointmentSourceEnum('source').notNull().default('PHONE'),
    transportType: transportTypeEnum('transport_type').notNull().default('DROP_OFF'),

    /** Customer's own words. Never overwrite with an op-code description. */
    customerConcerns: text('customer_concerns'),
    internalNotes: text('internal_notes'),

    /**
     * Odometer projected to the appointment date from observed miles/day.
     * Maintenance-due must be judged on this, not on a stale last reading.
     */
    projectedMileage: integer('projected_mileage'),

    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('appointments_store_scheduled_idx').on(t.storeId, t.scheduledAt),
    index('appointments_store_status_idx').on(t.storeId, t.status),
    index('appointments_advisor_idx').on(t.advisorId, t.scheduledAt),
    index('appointments_customer_idx').on(t.customerId),
    index('appointments_vehicle_idx').on(t.vehicleId),
  ],
)

export const repairOrders = pgTable(
  'repair_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
    customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
    vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'restrict' }),
    advisorId: uuid('advisor_id').references(() => users.id, { onDelete: 'set null' }),

    /** RO number as it appears in the DMS. The advisor's shared vocabulary. */
    roNumber: text('ro_number').notNull(),
    status: roStatusEnum('status').notNull().default('OPEN'),

    mileageIn: integer('mileage_in'),
    mileageOut: integer('mileage_out'),

    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),

    /** Totals by pay type — the split every fixed-ops manager watches. */
    customerPayTotal: numeric('customer_pay_total', { precision: 12, scale: 2 }).notNull().default('0'),
    warrantyTotal: numeric('warranty_total', { precision: 12, scale: 2 }).notNull().default('0'),
    internalTotal: numeric('internal_total', { precision: 12, scale: 2 }).notNull().default('0'),
    laborGross: numeric('labor_gross', { precision: 12, scale: 2 }).notNull().default('0'),
    partsGross: numeric('parts_gross', { precision: 12, scale: 2 }).notNull().default('0'),
    /** Sum of flat-rate hours sold. Drives hours-per-RO. */
    hoursSold: numeric('hours_sold', { precision: 8, scale: 2 }).notNull().default('0'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('repair_orders_store_number_unique').on(t.storeId, t.roNumber),
    index('repair_orders_store_opened_idx').on(t.storeId, t.openedAt),
    index('repair_orders_customer_idx').on(t.customerId),
    index('repair_orders_vehicle_idx').on(t.vehicleId),
    index('repair_orders_advisor_idx').on(t.advisorId, t.openedAt),
    index('repair_orders_status_idx').on(t.storeId, t.status),
  ],
)

export const roLines = pgTable(
  'ro_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    repairOrderId: uuid('repair_order_id').notNull().references(() => repairOrders.id, { onDelete: 'cascade' }),
    opCodeId: uuid('op_code_id').references(() => opCodes.id, { onDelete: 'set null' }),
    technicianId: uuid('technician_id').references(() => users.id, { onDelete: 'set null' }),

    lineNumber: integer('line_number').notNull(),
    description: text('description').notNull(),
    componentGroupKey: text('component_group_key'),

    payType: payTypeEnum('pay_type').notNull().default('CUSTOMER_PAY'),
    status: roLineStatusEnum('status').notNull().default('RECOMMENDED'),

    laborHours: numeric('labor_hours', { precision: 6, scale: 2 }).notNull().default('0'),
    laborAmount: numeric('labor_amount', { precision: 10, scale: 2 }).notNull().default('0'),
    partsAmount: numeric('parts_amount', { precision: 10, scale: 2 }).notNull().default('0'),
    /** What the customer actually owes after coverage and deductible. */
    customerAmount: numeric('customer_amount', { precision: 10, scale: 2 }).notNull().default('0'),

    /** The three C's — required for a defensible warranty claim. */
    complaint: text('complaint'),
    cause: text('cause'),
    correction: text('correction'),

    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: text('approved_by'),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ro_lines_ro_idx').on(t.repairOrderId),
    index('ro_lines_store_idx').on(t.storeId),
    index('ro_lines_component_idx').on(t.componentGroupKey),
  ],
)

/**
 * Declined work — the single largest untapped revenue pool in a service drive.
 * Persisted as its own record so it survives the RO and can be resurfaced
 * months later with a fresh price.
 */
export const declinedServices = pgTable(
  'declined_services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    repairOrderId: uuid('repair_order_id').references(() => repairOrders.id, { onDelete: 'set null' }),
    roLineId: uuid('ro_line_id').references(() => roLines.id, { onDelete: 'set null' }),
    customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),

    description: text('description').notNull(),
    componentGroupKey: text('component_group_key'),
    /** Price at the moment it was declined. Re-quote before re-offering. */
    quotedAmount: numeric('quoted_amount', { precision: 10, scale: 2 }).notNull().default('0'),
    declinedAt: timestamp('declined_at', { withTimezone: true }).notNull().defaultNow(),
    declineReason: text('decline_reason'),
    mileageAtDecline: integer('mileage_at_decline'),

    /** Set when the work is eventually sold, so it stops resurfacing. */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByRoId: uuid('resolved_by_ro_id').references(() => repairOrders.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('declined_services_customer_idx').on(t.customerId),
    index('declined_services_vehicle_idx').on(t.vehicleId),
    index('declined_open_idx').on(t.storeId, t.resolvedAt),
  ],
)

export const inspections = pgTable(
  'inspections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    repairOrderId: uuid('repair_order_id').references(() => repairOrders.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
    technicianId: uuid('technician_id').references(() => users.id, { onDelete: 'set null' }),

    mileage: integer('mileage'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    /** Shareable link for the customer to view results and approve on their phone. */
    shareToken: text('share_token').unique(),
    shareExpiresAt: timestamp('share_expires_at', { withTimezone: true }),
    viewedByCustomerAt: timestamp('viewed_by_customer_at', { withTimezone: true }),

    videoUrl: text('video_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('inspections_ro_idx').on(t.repairOrderId),
    index('inspections_vehicle_idx').on(t.vehicleId),
    index('inspections_store_idx').on(t.storeId),
  ],
)

/**
 * A single MPI line.
 *
 * The NUMERIC measurement is the point. Recording only "yellow" throws away the
 * data that makes wear prediction possible — two tread depths give a slope, and
 * a slope gives a date.
 */
export const inspectionItems = pgTable(
  'inspection_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    inspectionId: uuid('inspection_id').notNull().references(() => inspections.id, { onDelete: 'cascade' }),

    itemKey: text('item_key').notNull(),
    label: text('label').notNull(),
    componentGroupKey: text('component_group_key'),
    status: inspectionStatusEnum('status').notNull().default('NOT_CHECKED'),

    measurementValue: numeric('measurement_value', { precision: 10, scale: 2 }),
    measurementUnit: measurementUnitEnum('measurement_unit'),
    wheelPosition: wheelPositionEnum('wheel_position'),

    technicianNotes: text('technician_notes'),
    photoUrls: text('photo_urls'),

    /** Recommendation attached to this finding, so the sell call has a number. */
    recommendedOpCodeId: uuid('recommended_op_code_id').references(() => opCodes.id, { onDelete: 'set null' }),
    estimatedAmount: numeric('estimated_amount', { precision: 10, scale: 2 }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('inspection_items_inspection_idx').on(t.inspectionId),
    index('inspection_items_key_idx').on(t.itemKey),
    index('inspection_items_store_idx').on(t.storeId),
  ],
)

/**
 * Customer response to an MPI line, captured from their phone.
 *
 * Kept separate from the item so the approval carries its own timestamp, IP and
 * channel — this is the record you produce when a customer later disputes
 * authorising the work.
 */
export const inspectionApprovals = pgTable(
  'inspection_approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    inspectionId: uuid('inspection_id').notNull().references(() => inspections.id, { onDelete: 'cascade' }),
    inspectionItemId: uuid('inspection_item_id').references(() => inspectionItems.id, { onDelete: 'cascade' }),

    approved: boolean('approved').notNull(),
    amount: numeric('amount', { precision: 10, scale: 2 }),
    declineReason: text('decline_reason'),

    /** Provenance of the authorisation. */
    respondedAt: timestamp('responded_at', { withTimezone: true }).notNull().defaultNow(),
    respondedVia: text('responded_via').notNull().default('WEB'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    signatureUrl: text('signature_url'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('inspection_approvals_inspection_idx').on(t.inspectionId),
    index('inspection_approvals_store_idx').on(t.storeId),
  ],
)

/**
 * Every coverage decision the engine made, with the advisor's override and the
 * eventual real payer. Audit trail, dispute evidence, and the signal we use to
 * tune the rules.
 */
export const coverageDeterminations = pgTable(
  'coverage_determinations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
    repairOrderId: uuid('repair_order_id').references(() => repairOrders.id, { onDelete: 'set null' }),
    roLineId: uuid('ro_line_id').references(() => roLines.id, { onDelete: 'set null' }),

    componentGroupKey: text('component_group_key'),
    concernText: text('concern_text').notNull(),

    determinedPayer: payerEnum('determined_payer').notNull(),
    confidence: confidenceEnum('confidence').notNull(),
    customerOutOfPocket: numeric('customer_out_of_pocket', { precision: 10, scale: 2 }),
    coveredAmount: numeric('covered_amount', { precision: 10, scale: 2 }),
    warrantyTermName: text('warranty_term_name'),

    /** Full rule trace, stored as JSON text for later inspection. */
    reasoning: text('reasoning'),
    requiredActions: text('required_actions'),

    /** Populated when the advisor disagreed — the most valuable rows in the table. */
    advisorOverridePayer: payerEnum('advisor_override_payer'),
    overrideReason: text('override_reason'),
    /** Backfilled at RO close. Lets us measure how often the engine was right. */
    actualPayer: payerEnum('actual_payer'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('coverage_determinations_vehicle_idx').on(t.vehicleId),
    index('coverage_determinations_ro_idx').on(t.repairOrderId),
    index('coverage_determinations_store_created_idx').on(t.storeId, t.createdAt),
  ],
)

/**
 * What the advisor did with each ranked opportunity on a prep sheet.
 *
 * The only place SKIPPED is knowable. Sold work shows up as an RO line and
 * declined work as a declined service, but an opportunity the advisor never
 * raised leaves no trace anywhere else — and that gap is exactly what a
 * capture-rate metric is measuring. One row per opportunity per visit.
 */
export const prepSheetOutcomes = pgTable(
  'prep_sheet_outcomes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'cascade' }),
    advisorId: uuid('advisor_id').references(() => users.id, { onDelete: 'set null' }),
    customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),

    /** Engine-assigned key, stable within one build of this visit's sheet. */
    opportunityKey: text('opportunity_key').notNull(),
    opportunityType: text('opportunity_type').notNull(),
    title: text('title').notNull(),
    urgency: text('urgency').notNull(),
    likelyPayer: payerEnum('likely_payer').notNull(),

    /**
     * Snapshotted rather than re-derived at read time: prices move, and a
     * scorecard that silently restates last month's numbers is worthless.
     */
    estimatedAmount: numeric('estimated_amount', { precision: 10, scale: 2 }).notNull().default('0'),
    customerOutOfPocket: numeric('customer_out_of_pocket', { precision: 10, scale: 2 }).notNull().default('0'),

    outcome: opportunityOutcomeEnum('outcome').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('prep_sheet_outcomes_advisor_idx').on(t.storeId, t.advisorId, t.decidedAt),
    index('prep_sheet_outcomes_appointment_idx').on(t.appointmentId),
    // Re-deciding an item updates the row rather than double-counting it.
    uniqueIndex('prep_sheet_outcomes_unique_idx').on(t.appointmentId, t.opportunityKey),
  ],
)
