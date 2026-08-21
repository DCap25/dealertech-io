import type { CadenceTrigger } from './types'

/**
 * The follow-up rules every new dealership starts with.
 *
 * ---------------------------------------------------------------------------
 * WHY A FRESH TENANT WAS BROKEN WITHOUT THIS
 * ---------------------------------------------------------------------------
 * `generateTasks` produces nothing without rules, and nothing outside the demo
 * seed had ever created one. So a dealership provisioned this morning had an
 * empty follow-up list, would have an empty follow-up list a year later, and
 * the screen said "nothing to work" rather than "nobody has set this up" —
 * indistinguishable from the product deciding there was no work, which is the
 * worst way for a feature to be missing.
 *
 * These eight lived in the seed and only in the seed, which is how the
 * demonstration dealership ended up being the only store on the platform with
 * a working retention programme. Extracting them means the store a prospect
 * walks through and the store they are handed on day one behave the same way,
 * and that the two cannot drift apart later.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE EIGHT, AND WHY THEY ARE A STARTING POINT
 * ---------------------------------------------------------------------------
 * They are the follow-ups that are true of every service department: thank the
 * customer, catch a detractor before the manufacturer's survey does, re-offer
 * declined work while it is still relevant, chase a maintenance interval, use
 * a prepaid plan before it expires, sell a contract while the vehicle still
 * qualifies, and wake a customer who has stopped coming. None of them assumes
 * a brand, a market or a process.
 *
 * A store edits or switches them off from its own settings; nothing here is
 * re-applied afterwards, so a dealership that deletes the dormant-customer
 * rule does not find it back next week. Defaults are a starting position, not
 * a policy.
 *
 * Pure data. The insert lives with whoever is standing the store up.
 */

export interface DefaultCadenceRule {
  name: string
  trigger: CadenceTrigger
  /** Days after the triggering event. Negative fires ahead of a deadline. */
  offsetDays?: number
  /** Mileage triggers fire this far before the projected due odometer. */
  offsetMiles?: number
  assignToRole: string
  /** Minimum days between fires of this rule for one customer. */
  cooldownDays?: number
  /** What the caller should actually say. The difference between a task and a sale. */
  talkTrack?: string
}

export const DEFAULT_CADENCE_RULES: DefaultCadenceRule[] = [
  { name: 'Thank you / quality check', trigger: 'POST_VISIT_THANK_YOU', offsetDays: 2, assignToRole: 'BDC', talkTrack: 'Thank them, confirm the concern is resolved, catch a detractor before the OEM survey lands.' },
  { name: 'CSI pre-emption', trigger: 'CSI_PRE_EMPTION', offsetDays: 4, assignToRole: 'ADVISOR', talkTrack: 'Ask directly whether anything fell short. Fix it before the manufacturer asks.' },
  { name: 'Declined service re-offer', trigger: 'DECLINED_SERVICE_FOLLOW_UP', offsetDays: 10, assignToRole: 'BDC', cooldownDays: 45, talkTrack: 'Reference the exact item declined and re-quote at today prices. Lead with safety, not discount.' },
  { name: 'Second declined re-offer', trigger: 'DECLINED_SERVICE_FOLLOW_UP', offsetDays: 40, assignToRole: 'BDC', cooldownDays: 45 },
  { name: 'Maintenance due by mileage', trigger: 'MAINTENANCE_DUE_MILEAGE', offsetMiles: 500, assignToRole: 'BDC', talkTrack: 'Projected to hit the interval within two weeks. Offer two appointment times, not an open question.' },
  { name: 'Prepaid plan expiring', trigger: 'PPM_EXPIRING', offsetDays: -45, assignToRole: 'BDC', talkTrack: 'They already paid for these visits. Use it or lose it — book before expiry.' },
  { name: 'Factory warranty expiring', trigger: 'WARRANTY_EXPIRING', offsetDays: -90, assignToRole: 'ADVISOR', talkTrack: 'Coverage is about to end. Present a service contract while the vehicle still qualifies.' },
  { name: 'Dormant customer recovery', trigger: 'DORMANT_CUSTOMER', offsetDays: 400, assignToRole: 'BDC', cooldownDays: 120, talkTrack: 'Over a year since the last visit. Lead with a complimentary inspection, not a discount.' },
]

/**
 * The same eight, addressed to one rooftop.
 *
 * A function rather than a constant because the rows carry a store id, and a
 * shared mutable array that every caller spreads a store id into is one
 * accidental `push` away from a dealership inheriting another's rules.
 */
export function defaultCadenceRulesFor(storeId: string) {
  return DEFAULT_CADENCE_RULES.map((rule) => ({ storeId, ...rule }))
}
