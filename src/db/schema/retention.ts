import {
  pgTable, uuid, text, timestamp, boolean, integer, numeric, index, unique,
} from 'drizzle-orm/pg-core'
import { stores, users } from './tenancy'
import { customers, vehicles } from './customers'
import { appointments, repairOrders, declinedServices } from './service'
import { messageTemplates } from './communication'
import {
  cadenceTriggerEnum, callDirectionEnum, callOutcomeEnum, campaignStatusEnum,
  messageChannelEnum, taskOutcomeEnum, taskStatusEnum,
} from './enums'

/**
 * Retention marketing and the BDC.
 *
 * The gap this closes: variable ops runs a mandated follow-up cadence for
 * years after a sale, while fixed ops typically has nothing after "see you in
 * six months." Rules live in data so a store can tune them without a deploy.
 */

/** Manufacturer-recommended service intervals, per make/model/year. */
export const maintenanceSchedules = pgTable(
  'maintenance_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null store means shared reference data available to every tenant. */
    storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }),

    make: text('make').notNull(),
    model: text('model'),
    modelYearFrom: integer('model_year_from'),
    modelYearTo: integer('model_year_to'),

    intervalMiles: integer('interval_miles'),
    intervalMonths: integer('interval_months'),
    description: text('description').notNull(),
    opCodeKeys: text('op_code_keys'),
    componentGroupKeys: text('component_group_keys'),

    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('maintenance_schedules_make_idx').on(t.make, t.modelYearFrom),
    index('maintenance_schedules_store_idx').on(t.storeId),
  ],
)

/**
 * A store-configurable follow-up rule.
 *
 * Example: DECLINED_SERVICE_FOLLOW_UP, offset 10 days, owner BDC, SMS template
 * "declined_reoffer" — fires once per declined line and produces a task.
 */
export const cadenceRules = pgTable(
  'cadence_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    trigger: cadenceTriggerEnum('trigger').notNull(),

    /** Days after the triggering event. Negative fires ahead of a due date. */
    offsetDays: integer('offset_days').notNull().default(0),
    /** Mileage-based triggers fire this far before the projected due odometer. */
    offsetMiles: integer('offset_miles'),

    /** Who works it. Null means the vehicle's last advisor. */
    assignToRole: text('assign_to_role'),

    channel: messageChannelEnum('channel'),
    templateId: uuid('template_id').references(() => messageTemplates.id, { onDelete: 'set null' }),
    /** What the caller should actually say. The difference between a task and a sale. */
    talkTrack: text('talk_track'),

    /** Send automatically, or only queue a task for a human. */
    autoSend: boolean('auto_send').notNull().default(false),

    /** Guard against pestering: minimum days between fires of this rule per customer. */
    cooldownDays: integer('cooldown_days').notNull().default(30),
    priority: integer('priority').notNull().default(100),
    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cadence_rules_store_trigger_idx').on(t.storeId, t.trigger),
    index('cadence_rules_active_idx').on(t.storeId, t.isActive),
  ],
)

/** One instance of a rule firing — the BDC and advisor worklist. */
export const cadenceTasks = pgTable(
  'cadence_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    cadenceRuleId: uuid('cadence_rule_id').references(() => cadenceRules.id, { onDelete: 'set null' }),

    customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'cascade' }),

    // What prompted it.
    trigger: cadenceTriggerEnum('trigger').notNull(),
    sourceRepairOrderId: uuid('source_repair_order_id').references(() => repairOrders.id, { onDelete: 'set null' }),
    sourceDeclinedServiceId: uuid('source_declined_service_id').references(() => declinedServices.id, { onDelete: 'set null' }),
    sourceAppointmentId: uuid('source_appointment_id').references(() => appointments.id, { onDelete: 'set null' }),

    title: text('title').notNull(),
    detail: text('detail'),
    talkTrack: text('talk_track'),
    /**
     * The work this task is chasing.
     *
     * Null when the task is not about a specific service — a thank-you call or
     * a dormant-customer win-back has no component group, and nothing should
     * infer one. Closing an RO uses this to retire tasks for work that was
     * just sold, so a customer is never called to re-offer what they bought.
     */
    componentGroupKey: text('component_group_key'),
    /** Revenue on the table, so a rep can work the list highest-value first. */
    estimatedValue: numeric('estimated_value', { precision: 10, scale: 2 }),
    priority: integer('priority').notNull().default(100),

    assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    status: taskStatusEnum('status').notNull().default('PENDING'),

    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedByUserId: uuid('completed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    outcome: taskOutcomeEnum('outcome'),
    outcomeNotes: text('outcome_notes'),
    /** Set when the task produced a booking — how we measure the whole engine. */
    resultingAppointmentId: uuid('resulting_appointment_id').references(() => appointments.id, { onDelete: 'set null' }),

    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cadence_tasks_worklist_idx').on(t.storeId, t.status, t.dueAt),
    index('cadence_tasks_assigned_idx').on(t.assignedUserId, t.status, t.dueAt),
    index('cadence_tasks_customer_idx').on(t.customerId),
    index('cadence_tasks_trigger_idx').on(t.storeId, t.trigger),
    index('cadence_tasks_component_idx').on(t.storeId, t.componentGroupKey),
  ],
)

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    description: text('description'),
    status: campaignStatusEnum('status').notNull().default('DRAFT'),

    channel: messageChannelEnum('channel').notNull(),
    templateId: uuid('template_id').references(() => messageTemplates.id, { onDelete: 'set null' }),
    /** Marketing sends require marketing consent, checked per recipient at send time. */
    isMarketing: boolean('is_marketing').notNull().default(true),

    /** Audience definition, stored as JSON text. */
    audienceFilter: text('audience_filter'),

    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    targetCount: integer('target_count').notNull().default(0),
    sentCount: integer('sent_count').notNull().default(0),
    suppressedCount: integer('suppressed_count').notNull().default(0),
    appointmentCount: integer('appointment_count').notNull().default(0),
    attributedRevenue: numeric('attributed_revenue', { precision: 12, scale: 2 }).notNull().default('0'),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('campaigns_store_status_idx').on(t.storeId, t.status)],
)

export const campaignTargets = pgTable(
  'campaign_targets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),

    /** Null until sent; populated when suppressed for consent or quiet hours. */
    suppressionReason: text('suppression_reason'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    resultingAppointmentId: uuid('resulting_appointment_id').references(() => appointments.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('campaign_targets_unique').on(t.campaignId, t.customerId),
    index('campaign_targets_campaign_idx').on(t.campaignId),
  ],
)

/**
 * BDC call log.
 *
 * Kept separate from messages because a call has duration, an outcome and a
 * recording rather than a body, and because BDC performance is measured on
 * calls made versus appointments set.
 */
export const callLogs = pgTable(
  'call_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    cadenceTaskId: uuid('cadence_task_id').references(() => cadenceTasks.id, { onDelete: 'set null' }),

    direction: callDirectionEnum('direction').notNull(),
    outcome: callOutcomeEnum('outcome'),
    phoneNumber: text('phone_number').notNull(),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    durationSeconds: integer('duration_seconds'),

    notes: text('notes'),
    recordingUrl: text('recording_url'),
    /** Call recording requires consent in two-party states — track it explicitly. */
    recordingConsent: boolean('recording_consent').notNull().default(false),

    resultingAppointmentId: uuid('resulting_appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('call_logs_store_started_idx').on(t.storeId, t.startedAt),
    index('call_logs_customer_idx').on(t.customerId),
    index('call_logs_user_idx').on(t.userId, t.startedAt),
  ],
)

/** Free-form notes on a customer, pinnable so the drive sees them at write-up. */
export const customerNotes = pgTable(
  'customer_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),

    body: text('body').notNull(),
    /** Surfaces on the prep sheet — "always asks for Mike", "CSI detractor". */
    isPinned: boolean('is_pinned').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('customer_notes_customer_idx').on(t.customerId, t.createdAt),
    index('customer_notes_pinned_idx').on(t.customerId, t.isPinned),
  ],
)
