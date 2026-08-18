/**
 * The scheduling engine — slots, load, warnings, assignment.
 *
 * Everything re-exported here is pure and I/O-free, per the house rule: the
 * things that decide are testable without a database, and the screens render
 * over them. `store-rules.ts` is the one file in this folder that reads
 * anything, and it is imported directly by the surfaces that need it rather
 * than through this barrel, so nothing pulls a server-only module into a test.
 */

export {
  DEFAULT_RULES, dayRulesFor, minuteOfDay,
  type DayRules,
} from './rules'

export {
  slotsForDay, outsideHours, mayOverrideHours,
  type Slot,
} from './slots'

export {
  bookLoad, waiterLoad, countByAdvisor, capacityWarnings,
  type AdvisorOnDuty, type BookLoad, type CapacityInput, type ScheduledAppointment,
} from './capacity'

export {
  assignAdvisor, assignedBy,
  type AssignmentDecision, type AssignmentInput, type AssignmentReason,
} from './assign'
