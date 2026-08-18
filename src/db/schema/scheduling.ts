import {
  pgTable, uuid, integer, smallint, boolean, timestamp, unique, index,
} from 'drizzle-orm/pg-core'
import { stores } from './tenancy'

/**
 * What a store's book will hold, per weekday.
 *
 * One row per store per weekday. A weekday with no row is a day the store is
 * closed — that is how Sunday is expressed — and a store with no rows at all
 * falls through to `DEFAULT_RULES` in src/lib/scheduling/rules.ts, so the drive
 * works before anybody configures anything.
 *
 * The caps are the *advisor's book*, never the shop floor (DRIVE_PLAN D2/D3,
 * both decided): technician hours are dispatch and dispatch is the DMS's. The
 * one building-level number here is `maxWaitersPerSlot`, because a lounge holds
 * so many people whoever's book they sit in.
 *
 * Per-advisor overrides — a senior writer who takes more, a trainee capped low
 * — are a later nullable column on the roster, not a second table.
 */
export const schedulingRules = pgTable(
  'scheduling_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),

    /** 0 = Sunday … 6 = Saturday, matching `Date#getDay`. */
    weekday: smallint('weekday').notNull(),

    /**
     * Minutes from local midnight, in the store's own timezone.
     *
     * Not `time` columns: a `time without time zone` answers "07:00" and leaves
     * open which 07:00, and every calculation the scheduling engine does is
     * arithmetic on minutes anyway. Storing the unit it computes in removes a
     * parse and a question at once.
     */
    openMinute: integer('open_minute').notNull(),
    closeMinute: integer('close_minute').notNull(),
    slotMinutes: integer('slot_minutes').notNull().default(30),

    /** How many customers one advisor can greet in one slot. Usually 1–2. */
    maxPerAdvisorSlot: integer('max_per_advisor_slot').notNull().default(2),
    /** Write-ups per advisor per day — the number balanced assignment weighs. */
    maxPerAdvisorDay: integer('max_per_advisor_day').notNull().default(16),
    /** The lounge, across every book. */
    maxWaitersPerSlot: integer('max_waiters_per_slot').notNull().default(4),

    /**
     * Assign at booking, or leave the appointment for whoever claims it at
     * arrival — DRIVE_PLAN §9 **Q1, open**, defaulting to auto-assign per the
     * recommendation there. Both are real operating models; picking one in code
     * would be the product overruling the store. Pending Dan.
     *
     * Per weekday rather than per store because it can honestly differ — plenty
     * of drives assign Tuesday and run Saturday as a first-free-writer line —
     * and because it then travels with the rest of the numbers the booking
     * action already reads for that day, in one query rather than two.
     */
    autoAssign: boolean('auto_assign').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('scheduling_rules_store_weekday_unique').on(t.storeId, t.weekday),
    index('scheduling_rules_store_idx').on(t.storeId),
  ],
)
