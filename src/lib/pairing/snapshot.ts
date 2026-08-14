import { buildMenu, TIER_COPY, type MenuSelection } from '@/lib/menu/selection'
import { customerDetail, easyYesReasons } from '@/lib/prep-sheet/presentation'
import { explainerFor, worstReadingFor, type Reading } from '@/lib/explainer'
import type { PrepSheet } from '@/lib/prep-sheet'

/**
 * What actually travels to a customer tablet.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A WHITELIST
 * ---------------------------------------------------------------------------
 * The obvious implementation is to push the menu items straight across. That
 * would put `talkTrack`, `closeProbability` and `priorityScore` into a JSON
 * response served to a device sitting in a customer's hands — invisible on
 * screen and one devtools panel away from being read.
 *
 * So the snapshot is built field by field from an explicit list. Adding a
 * field to Opportunity does not add it here; somebody has to decide to send
 * it. A test asserts the forbidden ones never appear, at any depth.
 *
 * It is also a *snapshot*. The tablet never queries anything — it is handed a
 * frozen copy of what the advisor approved. A device that cannot ask questions
 * cannot be made to answer the wrong one.
 */

export interface DeviceItem {
  id: string
  title: string
  detail: string
  /** What the customer owes. Never the ticket, never the gross. */
  customerOutOfPocket: number
  /** Struck through beside the price when coverage carries part of it. */
  fullAmount: number
  badges: { label: string; tone: 'COVERED' | 'SAFETY' }[]
  /** Present when there is an animated explanation for this component. */
  explainerKey: string | null
  /** This vehicle's own measurement, if one was taken. */
  reading: Reading | null
}

export interface DeviceTier {
  tier: string
  title: string
  blurb: string
  items: DeviceItem[]
}

export interface DeviceSnapshot {
  /** Shown at the top of the tablet. The customer's own details, to them. */
  customerName: string
  vehicleLabel: string
  mileage: number
  tiers: DeviceTier[]
  customerTotal: number
  coveredTotal: number
  itemCount: number
}

/**
 * Fields that must never reach a device. Asserted by test rather than trusted.
 *
 * `detail` is deliberately absent from this list because the snapshot uses
 * `customerDetail()`, which is the already-sanitised wording — the raw
 * `detail` can carry instructions meant for the advisor.
 */
export const FORBIDDEN_KEYS = [
  'talkTrack',
  'closeProbability',
  'priorityScore',
  'estimatedAmount',
  'likelyPayer',
  'sourceId',
  'type',
  'urgency',
] as const

export function buildDeviceSnapshot(
  sheet: PrepSheet,
  selection: MenuSelection,
): DeviceSnapshot {
  const menu = buildMenu(sheet.opportunities, selection)

  return {
    customerName: sheet.customer.name,
    vehicleLabel: `${sheet.vehicle.modelYear} ${sheet.vehicle.make} ${sheet.vehicle.model ?? ''}`.trim(),
    mileage: sheet.projectedMileage,
    customerTotal: menu.customerTotal,
    coveredTotal: menu.coveredTotal,
    itemCount: menu.items.length,
    tiers: menu.tiers.map((group) => ({
      tier: group.tier,
      title: TIER_COPY[group.tier].title,
      blurb: TIER_COPY[group.tier].blurb,
      items: group.items.map(({ opportunity: o }) => {
        const explainer = explainerFor(o.componentGroupKey)
        return {
          id: o.id,
          title: o.title,
          // The sanitised wording, not o.detail.
          detail: customerDetail(o),
          customerOutOfPocket: o.customerOutOfPocket,
          fullAmount: o.estimatedAmount,
          badges: easyYesReasons(o)
            .filter((r) => r.tone === 'COVERED' || r.tone === 'SAFETY')
            .map((r) => ({ label: r.label, tone: r.tone as 'COVERED' | 'SAFETY' })),
          explainerKey: explainer?.key ?? null,
          reading: explainer ? worstReadingFor(explainer, sheet.inspectionHistory) : null,
        }
      }),
    })),
  }
}

export type DeviceDecision = 'ACCEPTED' | 'DECLINED' | 'PENDING'

/**
 * Decisions coming back from a tablet.
 *
 * Only ids that were actually on the snapshot are accepted. A device posting
 * an id it was never sent is either broken or being probed, and either way the
 * answer is to drop it rather than record a decision against an opportunity
 * nobody presented.
 */
export function sanitizeDecisions(
  snapshot: DeviceSnapshot,
  incoming: unknown,
): Record<string, DeviceDecision> {
  const allowed = new Set(snapshot.tiers.flatMap((t) => t.items.map((i) => i.id)))
  const out: Record<string, DeviceDecision> = {}

  if (!incoming || typeof incoming !== 'object') return out

  for (const [id, value] of Object.entries(incoming as Record<string, unknown>)) {
    if (!allowed.has(id)) continue
    if (value === 'ACCEPTED' || value === 'DECLINED' || value === 'PENDING') {
      out[id] = value
    }
  }
  return out
}
