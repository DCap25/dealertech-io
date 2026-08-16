import {
  pgTable, uuid, text, timestamp, boolean, integer, index, unique,
} from 'drizzle-orm/pg-core'
import { organizations, stores, users } from './tenancy'
import {
  collectionModeEnum, lifecycleActorEnum, lifecycleStatusEnum,
  onboardingStepStatusEnum, subscriptionStatusEnum,
} from './enums'

/**
 * Billing.
 *
 * ---------------------------------------------------------------------------
 * WHO OWNS WHAT
 * ---------------------------------------------------------------------------
 * Stripe is the source of truth for money — what is owed, what was paid, which
 * card failed. This schema is the source of truth for *access*: what a tenant
 * may do today, held in `organizations.lifecycle_status` and moved only by the
 * lifecycle engine. Signals travel one way. A webhook can tell us an invoice
 * failed; nothing in Stripe ever decides whether an advisor can open a prep
 * sheet.
 *
 * That separation is why `subscriptions` below is described as a mirror. Every
 * column in it is a denormalised copy of something Stripe already knows, kept
 * locally so that rendering a page never depends on a third-party API being up.
 * If it disagrees with Stripe, Stripe is right and the reconciler fixes it.
 *
 * ---------------------------------------------------------------------------
 * "CAPABILITY", NEVER "ENTITLEMENT"
 * ---------------------------------------------------------------------------
 * `entitlement` already means a customer's prepaid maintenance visits — see
 * src/lib/coverage/types.ts. Reusing it for what a *dealership* has bought
 * would make half the coverage engine read as billing code. Plan capabilities
 * are called capabilities, matching `DmsCapabilities`.
 *
 * See docs/SAAS_PLAN.md for the reasoning behind the shape of all of this.
 */

/**
 * The commercial identity of a dealer group.
 *
 * One per organization, created lazily — a tenant on trial has no billing
 * account at all, which is the honest representation of a dealership that has
 * never been asked for money.
 *
 * Deliberately absent: card numbers, bank details, anything that would make
 * this table interesting to steal. Stripe holds the payment instrument; this
 * holds a pointer to it.
 */
export const billingAccounts = pgTable(
  'billing_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().unique()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    /** Null until the first Stripe contact. */
    stripeCustomerId: text('stripe_customer_id').unique(),

    /** Card on file, or invoiced with net terms. Decides the whole rail. */
    collectionMode: collectionModeEnum('collection_mode').notNull().default('CARD'),

    /**
     * Where invoices and dunning go — accounts payable, usually, and almost
     * never the service manager who signed up. Billing mail sent to the person
     * who happened to create the account is billing mail nobody reads.
     */
    billingEmail: text('billing_email').notNull(),
    /** The legal entity, when it differs from the trading name. */
    billingName: text('billing_name'),

    /**
     * Purchase order number, echoed onto every Stripe invoice.
     *
     * Not decoration: a dealer group's AP department will reject an invoice
     * that does not carry the PO they raised, and the rejection arrives as
     * silence rather than as a message.
     */
    poNumber: text('po_number'),
    /** Null for CARD. 30/45/60 for INVOICE. */
    netTermsDays: integer('net_terms_days'),

    taxExempt: boolean('tax_exempt').notNull().default(false),

    /** Platform-facing. Never shown to the dealership. */
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('billing_accounts_org_idx').on(t.organizationId)],
)

/**
 * The local mirror of a Stripe subscription.
 *
 * Mirror, not master — see the file header. The one row that has no Stripe
 * counterpart is a comped account, where `stripe_subscription_id` is null and
 * `status` is COMPED; the reconciler knows to leave those alone rather than
 * reporting a missing subscription every night for the rest of its life.
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    billingAccountId: uuid('billing_account_id').notNull()
      .references(() => billingAccounts.id, { onDelete: 'cascade' }),

    /** Null only for COMPED. */
    stripeSubscriptionId: text('stripe_subscription_id').unique(),

    /** Resolves against the plan catalog in src/lib/billing/plans.ts. */
    planKey: text('plan_key').notNull(),
    status: subscriptionStatusEnum('status').notNull(),

    /**
     * How many rooftops we believe we are billing for.
     *
     * Checked nightly against the count of active stores. Drift is surfaced
     * rather than silently corrected: a rooftop added without a quantity bump
     * and a rooftop deactivated mid-dispute look identical to a repair
     * routine and are completely different conversations.
     */
    rooftopQuantity: integer('rooftop_quantity').notNull().default(1),

    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('subscriptions_account_idx').on(t.billingAccountId),
    index('subscriptions_status_idx').on(t.status),
  ],
)

/**
 * Append-only commercial history: plan, quantity, trial extension, comp, cancel.
 *
 * The billing analogue of `audit_log`, and written alongside it rather than
 * instead of it. This one answers "what did the commercial relationship look
 * like in March"; the audit log answers "who touched what". A comp that
 * outlives its justification is the specific failure this table prevents —
 * `reason` is required for anything a human initiates.
 */
export const subscriptionChanges = pgTable(
  'subscription_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id').notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),

    /** PLAN, QUANTITY, TRIAL_EXTENDED, COMPED, CANCELED, REACTIVATED. */
    kind: text('kind').notNull(),
    /** JSON text, same convention as `audit_log.changes`. */
    before: text('before'),
    after: text('after'),

    /** Null when the reconciler or a webhook made the change. */
    changedByUserId: uuid('changed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('subscription_changes_sub_idx').on(t.subscriptionId, t.createdAt)],
)

/**
 * Every lifecycle transition a tenant has ever made.
 *
 * Append-only, and the reason a status column is trustworthy at all: a bare
 * enum on `organizations` can be set by anything, and six months later nobody
 * can say why a dealership is suspended or who decided it. Same
 * revoked-never-deleted philosophy as `platform_admins`.
 */
export const lifecycleEvents = pgTable(
  'lifecycle_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    /** Null for the very first row, where there was no previous state. */
    fromStatus: lifecycleStatusEnum('from_status'),
    toStatus: lifecycleStatusEnum('to_status').notNull(),

    actor: lifecycleActorEnum('actor').notNull(),
    /** Set only when actor is PLATFORM_ADMIN. */
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('lifecycle_events_org_idx').on(t.organizationId, t.createdAt)],
)

/**
 * Raw webhook deliveries, exactly as Stripe sent them.
 *
 * ---------------------------------------------------------------------------
 * THIS TABLE IS THE IDEMPOTENCY MECHANISM
 * ---------------------------------------------------------------------------
 * Stripe retries, and retries look identical to first attempts. The unique
 * constraint on `stripe_event_id` is what makes a duplicate delivery a no-op:
 * insert first, and a conflict means we have already seen it and can answer
 * 200 without doing the work twice. Nothing downstream needs to be idempotent
 * on its own, because nothing downstream runs twice.
 *
 * Platform-only: no tenant policy at all. Raw payloads carry billing detail no
 * dealership should be able to read, including other dealerships'.
 */
export const stripeEvents = pgTable(
  'stripe_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    stripeEventId: text('stripe_event_id').notNull().unique(),
    eventType: text('event_type').notNull(),
    /** A test-mode event must be visibly test, not quietly mixed in. */
    livemode: boolean('livemode').notNull(),

    payload: text('payload').notNull(),

    /**
     * False when the object did not carry our metadata.
     *
     * In a dedicated Stripe account this should never happen, so it is stored
     * and alerted on rather than silently dropped — an irrelevant event is
     * evidence that something is pointed at the wrong account.
     */
    relevant: boolean('relevant').notNull().default(true),

    /** Null until applied. Non-null and `error` set means it failed. */
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('stripe_events_type_idx').on(t.eventType, t.createdAt),
    index('stripe_events_unprocessed_idx').on(t.processedAt),
  ],
)

/**
 * How far a rooftop has got through setup.
 *
 * Step keys live in code (src/lib/onboarding/steps.ts), not in a table, so
 * adding a step is a code change rather than a migration. This records only
 * progress.
 *
 * Store-scoped rather than org-scoped on purpose: labour rate, tax and op-code
 * mapping are per rooftop, and a group that onboarded one store has not
 * onboarded the others.
 */
export const onboardingSteps = pgTable(
  'onboarding_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),

    stepKey: text('step_key').notNull(),
    status: onboardingStepStatusEnum('status').notNull().default('PENDING'),

    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Null when the system observed the step rather than somebody ticking it. */
    completedByUserId: uuid('completed_by_user_id').references(() => users.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('onboarding_steps_store_key_unique').on(t.storeId, t.stepKey),
    index('onboarding_steps_store_idx').on(t.storeId),
  ],
)
