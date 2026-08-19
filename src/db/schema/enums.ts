import { pgEnum } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------- people
export const userRoleEnum = pgEnum('user_role', [
  'ADVISOR',
  'BDC',
  'TECHNICIAN',
  'DISPATCHER',
  'PARTS',
  'CASHIER',
  'SERVICE_MANAGER',
  'FIXED_OPS_DIRECTOR',
  'ADMIN',
  /**
   * The person who sold the car — DRIVE_PLAN D5.
   *
   * Nine roles and none of them sold anything, which is why the delivery
   * introduction had no actor. This one is deliberately the smallest role in
   * the product: one page, `/introduce`, and deny-by-default plus the fence in
   * src/lib/auth/sales.ts keeps every other surface shut. Sales-side CRM —
   * desking, ups, deals — stays out on purpose, or this becomes a second
   * product (D5, "what deliberately stays out").
   */
  'SALES',
])

export const contactChannelEnum = pgEnum('contact_channel', ['SMS', 'EMAIL', 'PHONE', 'NONE'])

// ------------------------------------------------------------ service drive
export const appointmentStatusEnum = pgEnum('appointment_status', [
  'SCHEDULED',
  'CONFIRMED',
  'ARRIVED',
  'IN_SERVICE',
  'READY',
  'DELIVERED',
  'NO_SHOW',
  'CANCELLED',
])

/** How the customer gets around while the car is in. Drives loaner planning and CSI. */
export const transportTypeEnum = pgEnum('transport_type', [
  'WAITER',
  'DROP_OFF',
  'LOANER',
  'RENTAL',
  'SHUTTLE',
  'PICKUP_DELIVERY',
  'TOW_IN',
])

export const appointmentSourceEnum = pgEnum('appointment_source', [
  'PHONE',
  'WALK_IN',
  'ONLINE',
  'BDC',
  'ADVISOR',
  'DMS_SYNC',
  'CAMPAIGN',
  'RECALL',
  /**
   * The delivery introduction — booked at the moment the keys change hands.
   *
   * Its own value rather than folding into ADVISOR because the whole point is
   * that it is measurable: "how many deliveries walked to the drive" is the
   * number a sales manager is asked for, and it is unanswerable if the
   * introduction books as an ordinary advisor booking (D5).
   */
  'SALES_INTRO',
])

export const roStatusEnum = pgEnum('ro_status', [
  'OPEN',
  'DISPATCHED',
  'IN_PROGRESS',
  'WAITING_PARTS',
  'WAITING_APPROVAL',
  'WAITING_SUBLET',
  'COMPLETE',
  'CLOSED',
  'VOID',
])

/** Every RO line is one of these three. Misrouting is the costliest mistake in the drive. */
export const payTypeEnum = pgEnum('pay_type', ['CUSTOMER_PAY', 'WARRANTY', 'INTERNAL'])

export const roLineStatusEnum = pgEnum('ro_line_status', [
  'RECOMMENDED',
  'PENDING_APPROVAL',
  'APPROVED',
  'DECLINED',
  'IN_PROGRESS',
  'COMPLETE',
])

// -------------------------------------------------------------- inspection
/** The universal MPI traffic light. */
export const inspectionStatusEnum = pgEnum('inspection_status', [
  'GREEN',
  'YELLOW',
  'RED',
  'NOT_CHECKED',
])

export const wheelPositionEnum = pgEnum('wheel_position', ['LF', 'RF', 'LR', 'RR', 'SPARE'])

export const measurementUnitEnum = pgEnum('measurement_unit', [
  'THIRTY_SECONDS', // tire tread
  'MILLIMETERS', // brake pad
  'PERCENT',
  'VOLTS',
  'CCA',
  'PSI',
  'INCHES',
])

// --------------------------------------------------------------- coverage
export const productTypeEnum = pgEnum('product_type', [
  'VSC', 'PPM', 'TIRE_WHEEL', 'KEY', 'DENT', 'WINDSHIELD', 'APPEARANCE', 'THEFT',
])

export const tierTypeEnum = pgEnum('tier_type', ['EXCLUSIONARY', 'INCLUSIONARY'])

export const deductibleTypeEnum = pgEnum('deductible_type', ['PER_VISIT', 'PER_REPAIR', 'NONE'])

export const contractStatusEnum = pgEnum('contract_status', [
  'ACTIVE', 'EXPIRED', 'CANCELLED', 'EXHAUSTED', 'PENDING_VERIFICATION',
])

/**
 * Where a contract record came from.
 *
 * `AI_EXTRACTION` (0031) is what an uploaded service agreement — PDF or image —
 * becomes once a model has read it and an advisor has confirmed it. It replaces
 * `PHOTO_EXTRACTION` as the value new rows are written with: the upload path
 * accepts both formats through one extraction, so a source value that names the
 * *camera* would be a lie on most of the rows it labelled.
 *
 * `PHOTO_EXTRACTION` stays because rows already carry it. Dropping an enum
 * value is not something you do to a column with live data in it, and the
 * provenance of those rows is still true — a person did photograph them.
 */
export const contractSourceEnum = pgEnum('contract_source', [
  'MANUAL', 'CSV_IMPORT', 'PDF_EXTRACTION', 'PHOTO_EXTRACTION', 'AI_EXTRACTION', 'DMS',
])

export const confidenceEnum = pgEnum('confidence', ['HIGH', 'MEDIUM', 'LOW'])

export const payerEnum = pgEnum('payer', [
  'OEM_RECALL', 'PPM', 'TIRE_WHEEL', 'OEM_WARRANTY', 'VSC', 'GOODWILL', 'CUSTOMER_PAY',
])

// ---------------------------------------------------------- communication
export const messageChannelEnum = pgEnum('message_channel', ['SMS', 'EMAIL', 'VOICE', 'IN_APP'])

export const messageDirectionEnum = pgEnum('message_direction', ['INBOUND', 'OUTBOUND'])

export const messageStatusEnum = pgEnum('message_status', [
  'QUEUED',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'UNDELIVERABLE',
  'BLOCKED_NO_CONSENT',
  'BLOCKED_QUIET_HOURS',
])

/**
 * TCPA defence depends on proving what consent existed and when.
 * Every change is an append-only event, never an update in place.
 */
export const consentEventTypeEnum = pgEnum('consent_event_type', [
  'GRANTED',
  'REVOKED',
  'STOP_KEYWORD',
  'HELP_KEYWORD',
  'BOUNCED',
  'COMPLAINED',
  'IMPORTED',
])

export const consentScopeEnum = pgEnum('consent_scope', [
  'SMS_TRANSACTIONAL',
  'SMS_MARKETING',
  'EMAIL_TRANSACTIONAL',
  'EMAIL_MARKETING',
  'VOICE',
])

// ------------------------------------------------------------- retention
export const cadenceTriggerEnum = pgEnum('cadence_trigger', [
  'POST_VISIT_THANK_YOU',
  'CSI_PRE_EMPTION',
  'DECLINED_SERVICE_FOLLOW_UP',
  'MAINTENANCE_DUE_MILEAGE',
  'MAINTENANCE_DUE_TIME',
  'OEM_SCHEDULE_INTERVAL',
  'PPM_EXPIRING',
  'WARRANTY_EXPIRING',
  'CONTRACT_EXPIRING',
  'OPEN_RECALL',
  'STATE_INSPECTION_DUE',
  'SEASONAL',
  'DORMANT_CUSTOMER',
  'MISSED_APPOINTMENT',
])

export const taskStatusEnum = pgEnum('task_status', [
  'PENDING', 'IN_PROGRESS', 'COMPLETED', 'SNOOZED', 'DISMISSED', 'EXPIRED',
])

export const taskOutcomeEnum = pgEnum('task_outcome', [
  'APPOINTMENT_SET',
  'CALLBACK_REQUESTED',
  'NOT_INTERESTED',
  'NO_ANSWER',
  'LEFT_VOICEMAIL',
  'WRONG_NUMBER',
  'SOLD_ELSEWHERE',
  'VEHICLE_SOLD',
  'DO_NOT_CONTACT',
])

export const campaignStatusEnum = pgEnum('campaign_status', [
  'DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED',
])

// --------------------------------------------------------------- BDC
export const callDirectionEnum = pgEnum('call_direction', ['INBOUND', 'OUTBOUND'])

export const callOutcomeEnum = pgEnum('call_outcome', [
  'CONNECTED',
  'VOICEMAIL',
  'NO_ANSWER',
  'BUSY',
  'WRONG_NUMBER',
  'DISCONNECTED',
])

// -------------------------------------------------------------- integration
export const dmsVendorEnum = pgEnum('dms_vendor', [
  'CDK', 'REYNOLDS', 'TEKION', 'DEALERTRACK', 'PBS', 'AUTOMATE', 'DEALERBUILT',
  'XTIME', 'MYKAARMA', 'DEALER_FX', 'CSV', 'MANUAL',
])

export const syncDirectionEnum = pgEnum('sync_direction', ['PULL', 'PUSH', 'BIDIRECTIONAL'])

export const syncStatusEnum = pgEnum('sync_status', [
  'PENDING', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED',
])

export const syncEntityEnum = pgEnum('sync_entity', [
  'CUSTOMER', 'VEHICLE', 'APPOINTMENT', 'REPAIR_ORDER', 'RO_LINE',
  'INSPECTION', 'CONTRACT', 'OP_CODE', 'TECHNICIAN',
])

/**
 * What became of a ranked opportunity on a visit.
 *
 * SKIPPED means it was never raised with the customer — not that they said no.
 * CALL_ME is the customer's own answer and is neither: they believe it and are
 * not ready today. It was added by migration 0030, after the timeline made the
 * cost of not having it visible — every call-me in the table before that is
 * stored as SKIPPED and cannot be recovered, because the two were the same
 * value. The authority on the meanings is `OpportunityOutcome` in
 * src/lib/performance/types.ts.
 */
export const opportunityOutcomeEnum = pgEnum('opportunity_outcome', [
  'ACCEPTED',
  'DECLINED',
  'CALL_ME',
  'SKIPPED',
])

// ---------------------------------------------------------------- billing
/**
 * Where a tenant stands commercially. The single source of truth for access —
 * Stripe only ever *informs* this, via the lifecycle engine in
 * src/lib/billing/lifecycle.ts. See docs/SAAS_PLAN.md §4.
 */
export const lifecycleStatusEnum = pgEnum('lifecycle_status', [
  'TRIAL',
  'EXPIRED',
  'ACTIVE',
  'PAST_DUE',
  'RESTRICTED',
  'SUSPENDED',
  'CANCELED',
  'CHURNED',
  'COMPED',
])

/** Who moved a tenant between lifecycle states. */
export const lifecycleActorEnum = pgEnum('lifecycle_actor', [
  'SYSTEM',
  'WEBHOOK',
  'RECONCILER',
  'PLATFORM_ADMIN',
])

/** How a dealer group pays: card on file, or invoiced with net terms. */
export const collectionModeEnum = pgEnum('collection_mode', ['CARD', 'INVOICE'])

/** Mirror of Stripe's subscription status, plus COMPED which Stripe never sees. */
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'COMPED',
])

export const onboardingStepStatusEnum = pgEnum('onboarding_step_status', [
  'PENDING',
  'DONE',
  'SKIPPED',
])
