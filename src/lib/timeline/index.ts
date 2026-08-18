/**
 * The CRM timeline — DRIVE_PLAN D6.
 *
 * Everything re-exported here is pure and I/O-free, per the house rule.
 * `load.ts` is the one file in this folder that reads anything and is imported
 * directly by the surfaces that need it, so nothing pulls a server-only module
 * into a test or a client component.
 */

export * from './types'

export {
  assembleEvents, assembleTimeline, groupByDay, mergeEvents,
  appointmentEvents, menuEvents, repairOrderEvents, declineEvents,
  visitOutcomeEvents, handoffEvents, callEvents, taskEvents, noteEvents,
  mileageEvents,
} from './assemble'

export { openThreads } from './threads'
export { buildVisitCard } from './visit-card'
export { channelPhrase, itemsOfSnapshot, readPresentation, type FrozenPresentation } from './frozen'
