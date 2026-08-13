import type { Opportunity, PrepSheet } from './types'
import { easyYesReasons, type OpportunityDecision } from './presentation'

/**
 * Command-centre logic: what to do next, and how to hand it off.
 *
 * Pure and I/O-free. Deliberately narrow — DealerTech sits beside the DMS and
 * answers two questions ("who pays" and "what next"), so nothing here writes an
 * RO, dispatches, or prices parts. The hand-off is text an advisor pastes.
 */

// ===========================================================================
// Category — the everyday jobs that make up most of a service drive.

export type UpsellCategory =
  | 'TIRES'
  | 'BRAKES'
  | 'ALIGNMENT'
  | 'APPEARANCE'
  | 'FLUIDS'
  | 'FILTERS'
  | 'BATTERY'
  | 'INSPECTION'
  | 'RECALL'
  | 'COVERAGE'
  | 'OTHER'

const CATEGORY_BY_GROUP: Record<string, UpsellCategory> = {
  TIRES: 'TIRES',
  WHEELS_RIMS: 'TIRES',
  TIRE_ROTATION: 'TIRES',
  TIRE_BALANCE: 'TIRES',

  BRAKE_PADS_SHOES: 'BRAKES',
  BRAKE_ROTORS_DRUMS: 'BRAKES',
  BRAKE_CALIPERS: 'BRAKES',
  BRAKE_LINES: 'BRAKES',
  PARKING_BRAKE: 'BRAKES',

  WHEEL_ALIGNMENT: 'ALIGNMENT',
  STRUTS_SHOCKS: 'ALIGNMENT',

  DENTS_DINGS: 'APPEARANCE',
  PAINT_FINISH: 'APPEARANCE',
  WINDSHIELD: 'APPEARANCE',
  SIDE_REAR_GLASS: 'APPEARANCE',

  OIL_CHANGE: 'FLUIDS',
  TRANS_FLUID_SERVICE: 'FLUIDS',
  DIFF_FLUID_SERVICE: 'FLUIDS',
  COOLANT_SERVICE: 'FLUIDS',
  BRAKE_FLUID_SERVICE: 'FLUIDS',
  FUEL_INDUCTION_SERVICE: 'FLUIDS',

  ENGINE_AIR_FILTER: 'FILTERS',
  CABIN_AIR_FILTER: 'FILTERS',
  WIPER_BLADES: 'FILTERS',

  BATTERY_12V: 'BATTERY',
  BATTERY_SERVICE: 'BATTERY',

  MULTI_POINT_INSPECTION: 'INSPECTION',
  STATE_INSPECTION: 'INSPECTION',
  DIAGNOSTIC_SCAN: 'INSPECTION',
}

export interface CategoryStyle {
  category: UpsellCategory
  label: string
  /** Single glyph — cheaper than an icon set and legible at a glance. */
  glyph: string
}

const CATEGORY_META: Record<UpsellCategory, { label: string; glyph: string }> = {
  TIRES: { label: 'Tires', glyph: '◎' },
  BRAKES: { label: 'Brakes', glyph: '◍' },
  ALIGNMENT: { label: 'Alignment', glyph: '⇔' },
  APPEARANCE: { label: 'Appearance', glyph: '◆' },
  FLUIDS: { label: 'Fluids', glyph: '◊' },
  FILTERS: { label: 'Filters', glyph: '▤' },
  BATTERY: { label: 'Battery', glyph: '▮' },
  INSPECTION: { label: 'Inspection', glyph: '✓' },
  RECALL: { label: 'Recall', glyph: '!' },
  COVERAGE: { label: 'Coverage', glyph: '§' },
  OTHER: { label: 'Service', glyph: '•' },
}

export function categorize(o: Opportunity): CategoryStyle {
  // Type wins over component group: a recall on a brake line is a recall
  // conversation, not a brake sale.
  if (o.type === 'RECALL_OPEN') return { category: 'RECALL', ...CATEGORY_META.RECALL }
  if (o.type === 'WARRANTY_EXPIRING' || o.type === 'CONTRACT_UPSELL') {
    return { category: 'COVERAGE', ...CATEGORY_META.COVERAGE }
  }

  const category = (o.componentGroupKey && CATEGORY_BY_GROUP[o.componentGroupKey]) || 'OTHER'
  return { category, ...CATEGORY_META[category] }
}

// ===========================================================================
// What to present next

export interface NextAction {
  opportunity: Opportunity
  /** Short reason, written for the advisor rather than the customer. */
  reason: string
  /** Position in the remaining queue, for "1 of 4" style progress. */
  remaining: number
}

/**
 * The single best thing to raise next.
 *
 * The sheet is already ranked by the prep-sheet engine, so this does not
 * re-rank — it takes the top item still outstanding and explains why it is
 * top. Re-ranking here would mean two different orders in one product.
 */
export function recommendNext(
  opportunities: Opportunity[],
  decisions: Record<string, OpportunityDecision>,
): NextAction | null {
  const pending = opportunities.filter((o) => (decisions[o.id] ?? 'PENDING') === 'PENDING')
  const next = pending[0]
  if (!next) return null

  return { opportunity: next, reason: reasonFor(next), remaining: pending.length }
}

function reasonFor(o: Opportunity): string {
  if (o.urgency === 'SAFETY') return 'Safety item — goes first regardless of price'
  if (o.likelyPayer === 'OEM_RECALL') return 'Manufacturer pays — free to the customer'
  if (o.customerOutOfPocket === 0 && o.likelyPayer !== 'CUSTOMER_PAY') {
    return 'Costs them nothing — the easiest yes on the sheet'
  }
  if (o.estimatedAmount > 0 && o.customerOutOfPocket / o.estimatedAmount <= 0.25) {
    return 'Coverage carries most of it'
  }

  const easy = easyYesReasons(o)[0]
  if (easy) return easy.label
  return 'Highest ranked item still outstanding'
}

// ===========================================================================
// DMS hand-off
//
// We do not write to the DMS. The advisor is already logged into it, and the
// fastest honest path is a clean block they paste into the line they are
// keying anyway.

const PAY_TYPE_BY_PAYER: Record<string, string> = {
  OEM_RECALL: 'W (recall campaign)',
  OEM_WARRANTY: 'W (factory warranty)',
  VSC: 'C (service contract — bill administrator)',
  PPM: 'C (prepaid maintenance)',
  TIRE_WHEEL: 'C (tire & wheel product)',
  GOODWILL: 'I (internal / goodwill)',
  CUSTOMER_PAY: 'C (customer pay)',
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

/**
 * Drop a leading "customer states" from a concern.
 *
 * Schedulers and DMS imports commonly store the phrase inside the concern
 * text, and our own label adds it again — "Customer states: Customer states
 * noise from the front end" is the kind of thing that makes an advisor stop
 * pasting and start retyping.
 */
export function stripConcernPrefix(concern: string): string {
  const trimmed = concern.trim()
  const match = /^(customer\s+states?|cust\s+states?|c\/s)\b[:\-\s]*/i.exec(trimmed)
  if (!match) return trimmed
  const rest = trimmed.slice(match[0].length).trim()
  return rest.length > 0 ? rest : trimmed
}

/** One RO line's worth of hand-off text. */
export function buildHandoffLine(o: Opportunity): string {
  const lines = [
    `${o.title}`,
    `  Concern: ${o.detail}`,
    `  Pay type: ${PAY_TYPE_BY_PAYER[o.likelyPayer] ?? o.likelyPayer}`,
    `  Estimate: ${money(o.estimatedAmount)} · customer owes ${money(o.customerOutOfPocket)}`,
  ]
  const covered = o.estimatedAmount - o.customerOutOfPocket
  if (covered > 0) {
    lines.push(`  Covered: ${money(covered)} — confirm with administrator before starting`)
  }
  return lines.join('\n')
}

/**
 * The whole hand-off block for a visit.
 *
 * Plain text with no markdown: it is going into a DMS comment field, and every
 * asterisk an advisor has to delete is a reason to stop using this.
 */
export function buildHandoffNote(
  sheet: PrepSheet,
  decisions: Record<string, OpportunityDecision>,
  asOf: Date = new Date(),
): string {
  const accepted = sheet.opportunities.filter((o) => decisions[o.id] === 'ACCEPTED')
  const declined = sheet.opportunities.filter((o) => decisions[o.id] === 'DECLINED')

  const vehicle = `${sheet.vehicle.modelYear} ${sheet.vehicle.make} ${sheet.vehicle.model ?? ''}`.trim()
  const out: string[] = [
    `${sheet.customer.name} — ${vehicle}`,
    `VIN ${sheet.vehicle.vin} · ${sheet.projectedMileage.toLocaleString()} mi · ${asOf.toLocaleDateString('en-US')}`,
  ]

  if (sheet.appointment?.concerns) {
    out.push(`Customer states: ${stripConcernPrefix(sheet.appointment.concerns)}`)
  }

  out.push('', 'APPROVED')
  if (accepted.length === 0) {
    out.push('  (none)')
  } else {
    for (const o of accepted) out.push(buildHandoffLine(o))
  }

  if (declined.length > 0) {
    out.push('', 'DECLINED — logged for follow-up')
    for (const o of declined) {
      out.push(`  ${o.title} — ${money(o.estimatedAmount)}`)
    }
  }

  const totalCustomer = accepted.reduce((s, o) => s + o.customerOutOfPocket, 0)
  const totalCovered = accepted.reduce(
    (s, o) => s + Math.max(0, o.estimatedAmount - o.customerOutOfPocket),
    0,
  )
  out.push('', `Customer total: ${money(totalCustomer)}`)
  if (totalCovered > 0) out.push(`Covered by warranty/contract: ${money(totalCovered)}`)

  out.push(
    '',
    'Coverage determinations are advisory and confirmed with the administrator or manufacturer before work begins.',
  )

  return out.join('\n')
}

/** Count of items an advisor has a hand-off for. */
export function handoffCount(
  opportunities: Opportunity[],
  decisions: Record<string, OpportunityDecision>,
): number {
  return opportunities.filter((o) => decisions[o.id] === 'ACCEPTED').length
}
