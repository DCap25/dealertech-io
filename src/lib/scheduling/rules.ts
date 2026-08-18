/**
 * What a store's book will hold — the frame every other function here reads.
 *
 * ---------------------------------------------------------------------------
 * WHOSE CAPACITY THIS IS
 * ---------------------------------------------------------------------------
 * The advisor's, never the shop floor's (DRIVE_PLAN D2 and D3, both decided).
 * Store hours and slot length give the frame; the caps that matter live on the
 * *book* — how many customers one writer can greet at 8:00, and how many
 * write-ups they can carry in a day. Technician hours are dispatch, dispatch is
 * the DMS's, and nothing here models a bay.
 *
 * The one building-level number kept is `maxWaitersPerSlot`: a lounge holds so
 * many people whoever's book they sit in, and `transportType` already knows who
 * waits.
 *
 * Pure and I/O-free. `store-rules.ts` is the only file in this folder that
 * touches a database.
 */

/**
 * One weekday's rules for one store.
 *
 * Times are **minutes from local midnight** rather than `time` columns. A
 * `time without time zone` answers "07:00" and leaves open which 07:00, and the
 * engine's every calculation is arithmetic on minutes anyway — storing the unit
 * it computes in removes a parse and a question at once. The store's own
 * timezone is the one these are read in.
 */
export interface DayRules {
  /** 0 = Sunday … 6 = Saturday, matching `Date#getDay`. */
  weekday: number
  openMinute: number
  closeMinute: number
  slotMinutes: number

  /** How many customers one advisor can greet in one slot. Usually 1–2. */
  maxPerAdvisorSlot: number
  /** Write-ups per advisor per day — the number balanced assignment weighs. */
  maxPerAdvisorDay: number
  /** The lounge, across every book. */
  maxWaitersPerSlot: number

  /**
   * Assign an advisor when the appointment is booked, or leave it in the pool
   * for whoever claims it at arrival?
   *
   * DRIVE_PLAN §9 **Q1 is open**. Both are real operating models — some drives
   * genuinely run as a first-free-writer line — so the answer is a store
   * setting rather than a decision taken in code, defaulting to auto-assign per
   * the §9 recommendation. Pending Dan; if he says claim-at-arrival is the
   * modal store, only `DEFAULT_RULES` and the column default change.
   */
  autoAssign: boolean
}

/**
 * What a store gets before anybody configures anything.
 *
 * Mon–Fri 7:00–18:00 and a short Saturday is the ordinary shape of an American
 * service drive; Sunday is absent, which is how "closed" is expressed (see
 * `dayRulesFor`). The caps are deliberately loose enough not to warn on a
 * normal Tuesday and tight enough to catch the Monday 8am where five write-ups
 * land on one advisor — two greetings per half hour, sixteen write-ups a day,
 * four waiters in the lounge at once.
 *
 * These are a *default*, not a recommendation: the first thing a real store
 * does is set their own, and every number here is one row of
 * `scheduling_rules` away from being replaced.
 */
export const DEFAULT_RULES: DayRules[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  openMinute: 7 * 60,
  closeMinute: 18 * 60,
  slotMinutes: 30,
  maxPerAdvisorSlot: 2,
  maxPerAdvisorDay: 16,
  maxWaitersPerSlot: 4,
  autoAssign: true,
})).concat([{
  weekday: 6,
  openMinute: 8 * 60,
  closeMinute: 14 * 60,
  slotMinutes: 30,
  maxPerAdvisorSlot: 2,
  maxPerAdvisorDay: 10,
  maxWaitersPerSlot: 4,
  autoAssign: true,
}])

/**
 * The rules governing one calendar day, or null when the store is closed.
 *
 * Two different absences, deliberately distinguished:
 *
 *  - **No rows at all** — the store has never configured anything, so it gets
 *    `DEFAULT_RULES` and the drive works on day one.
 *  - **Rows, but none for this weekday** — the store said what its week looks
 *    like and this day was not in it. That is a closed day, and answering it
 *    with a default would quietly open a dealership on Sunday.
 */
export function dayRulesFor(rules: DayRules[], day: Date): DayRules | null {
  const source = rules.length === 0 ? DEFAULT_RULES : rules
  return source.find((r) => r.weekday === day.getDay()) ?? null
}

/** Minutes from local midnight, for a moment on the day it falls in. */
export function minuteOfDay(when: Date): number {
  return when.getHours() * 60 + when.getMinutes()
}
