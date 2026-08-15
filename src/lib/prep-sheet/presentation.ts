import { differenceInCalendarDays } from 'date-fns'
import type { Contract } from '@/lib/coverage'
import type { TermStatus } from '@/lib/warranty'
import type { Opportunity, PrepSheet } from './types'

/**
 * Pure presentation helpers.
 *
 * Everything the prep sheet UI needs in order to decide HOW to draw something
 * lives here, so the components stay dumb and this stays testable. No React,
 * no I/O, no decisions about who pays — the coverage engine remains the only
 * authority on that.
 */

export type CoverageTone = 'GOOD' | 'WARNING' | 'CRITICAL' | 'EXPIRED'
export type CoverageKind = 'WARRANTY' | 'VSC' | 'PPM' | 'TIRE_WHEEL'

export interface CoverageSegment {
  key: string
  label: string
  /** Fits inside a ring. */
  shortLabel: string
  kind: CoverageKind
  /** 0–100, how much life is left. Drives both the ring sweep and the colour. */
  percentRemaining: number
  tone: CoverageTone
  active: boolean
  /** Headline figure, e.g. "32 mo". */
  primary: string
  /** Supporting figure, e.g. "32,179 mi". */
  secondary: string
  detail: string
}

/** Below this much life left, an advisor should be talking about it today. */
const WARNING_THRESHOLD = 40
const CRITICAL_THRESHOLD = 15

export function toneForPercent(percent: number, active: boolean): CoverageTone {
  /**
   * Only `active` decides expired — never the percentage.
   *
   * A term can sit at 0% and still be live: 0 months remaining but 8,860
   * miles left is coverage the customer can still use today. Colouring that
   * grey tells the advisor it is gone, which is precisely the mistake this
   * product exists to prevent. At 0% and active it is CRITICAL — use it now.
   */
  if (!active) return 'EXPIRED'
  if (percent <= CRITICAL_THRESHOLD) return 'CRITICAL'
  if (percent <= WARNING_THRESHOLD) return 'WARNING'
  return 'GOOD'
}

/**
 * Percentage of a warranty term still unused.
 *
 * Takes the MINIMUM of the time and mileage axes, because a term ends the
 * moment either one runs out — showing the rosier of the two would be a lie
 * to whichever customer is about to lose coverage.
 */
export function termPercentRemaining(term: TermStatus): number {
  if (!term.active) return 0
  const byMonths =
    term.term.months === null || term.monthsRemaining === null
      ? 100
      : (term.monthsRemaining / term.term.months) * 100
  const byMiles =
    term.term.miles === null || term.milesRemaining === null
      ? 100
      : (term.milesRemaining / term.term.miles) * 100
  return Math.max(0, Math.min(100, Math.min(byMonths, byMiles)))
}

function contractPercentRemaining(
  contract: Contract,
  currentMileage: number,
  asOf: Date,
): number {
  const monthsTotal = contract.termMonths
  const milesLimit = contract.expirationMiles ?? contract.termMiles

  let byTime = 100
  if (monthsTotal) {
    const end = contract.expirationDate
      ? contract.expirationDate
      : new Date(contract.purchaseDate.getTime() + monthsTotal * 30.44 * 86_400_000)
    const totalDays = monthsTotal * 30.44
    const daysLeft = differenceInCalendarDays(end, asOf)
    byTime = (daysLeft / totalDays) * 100
  }

  let byMiles = 100
  if (milesLimit) {
    const start = contract.purchaseMileage ?? 0
    const span = Math.max(1, milesLimit - start)
    byMiles = ((milesLimit - currentMileage) / span) * 100
  }

  return Math.max(0, Math.min(100, Math.min(byTime, byMiles)))
}

const PRODUCT_LABEL: Record<string, string> = {
  VSC: 'Service Contract',
  PPM: 'Prepaid Maintenance',
  TIRE_WHEEL: 'Tire & Wheel',
  KEY: 'Key Replacement',
  DENT: 'Dent & Ding',
  WINDSHIELD: 'Windshield',
  APPEARANCE: 'Appearance',
  THEFT: 'Theft',
}

/**
 * The coverage stack, ordered so the most consequential ring reads first:
 * factory warranty, then purchased products, then prepaid visits.
 */
export function buildCoverageSegments(
  sheet: PrepSheet,
  asOf: Date = new Date(),
  /**
   * Which kinds to include. Defaults to everything so existing callers — the
   * Co-Pilot grounding in particular — keep seeing the whole picture; the prep
   * sheet narrows it to factory warranty because purchased products get their
   * own row above the rings.
   */
  kinds?: CoverageKind[],
): CoverageSegment[] {
  const segments: CoverageSegment[] = []
  const mileage = sheet.projectedMileage

  const terms: [TermStatus | null, string][] = [
    [sheet.warranty.basic, 'Basic'],
    [sheet.warranty.powertrain, 'Powertrain'],
    [sheet.warranty.hybridEv, 'Hybrid / EV'],
    [sheet.warranty.emissionsLong, 'Emissions'],
  ]

  for (const [term, shortLabel] of terms) {
    if (!term) continue
    const percent = termPercentRemaining(term)
    segments.push({
      key: `warranty:${term.name}`,
      label: term.name,
      shortLabel,
      kind: 'WARRANTY',
      percentRemaining: percent,
      tone: toneForPercent(percent, term.active),
      active: term.active,
      primary: term.active ? `${term.monthsRemaining ?? '∞'} mo` : 'Expired',
      secondary: term.active
        ? `${term.milesRemaining?.toLocaleString() ?? '∞'} mi`
        : term.expiredBy
          ? `on ${term.expiredBy.toLowerCase()}`
          : '',
      detail: term.active
        ? `${term.monthsRemaining ?? '∞'} months and ${term.milesRemaining?.toLocaleString() ?? '∞'} miles remaining. ${
            term.limitingFactor === 'UNLIMITED'
              ? 'No limit on either axis.'
              : `${term.limitingFactor === 'TIME' ? 'Time' : 'Mileage'} will run out first.`
          }`
        : `Expired${term.expiredBy ? ` on ${term.expiredBy.toLowerCase()}` : ''}.`,
    })
  }

  for (const contract of sheet.contracts) {
    if (contract.productType === 'PPM') continue // shown as visit counts below
    const percent = contractPercentRemaining(contract, mileage, asOf)
    const active = contract.status === 'ACTIVE' && percent > 0
    segments.push({
      key: `contract:${contract.id}`,
      label: `${contract.adminCompany} ${PRODUCT_LABEL[contract.productType] ?? contract.productType}`,
      shortLabel: contract.productType === 'TIRE_WHEEL' ? 'Tire & Wheel' : 'VSC',
      kind: contract.productType === 'TIRE_WHEEL' ? 'TIRE_WHEEL' : 'VSC',
      percentRemaining: percent,
      tone: toneForPercent(percent, active),
      active,
      primary: active ? 'Active' : 'Expired',
      secondary:
        contract.deductibleAmount > 0
          ? `$${contract.deductibleAmount} deductible`
          : 'No deductible',
      detail: active
        ? `${contract.coverageTier ? `${contract.coverageTier} · ` : ''}${
            contract.tierType === 'EXCLUSIONARY'
              ? 'Exclusionary — covered unless expressly excluded.'
              : 'Named component — covered only if expressly listed.'
          }${contract.requiresPriorAuthorization ? ' Prior authorisation required before teardown.' : ''}`
        : 'No longer in force.',
    })
  }

  // Prepaid visits are a count, not a duration — percentage is visits left.
  const byLabel = new Map<string, { total: number; used: number; expiresOn?: Date }>()
  for (const e of sheet.prepaidEntitlements) {
    const current = byLabel.get(e.label) ?? { total: 0, used: 0, expiresOn: e.expiresOn }
    byLabel.set(e.label, {
      total: current.total + e.totalAllowed,
      used: current.used + e.used,
      expiresOn: current.expiresOn ?? e.expiresOn,
    })
  }
  for (const [label, v] of byLabel) {
    const remaining = v.total - v.used
    const percent = v.total > 0 ? (remaining / v.total) * 100 : 0
    const daysToExpiry = v.expiresOn ? differenceInCalendarDays(v.expiresOn, asOf) : null
    const expiringSoon = daysToExpiry !== null && daysToExpiry <= 90 && remaining > 0
    segments.push({
      key: `ppm:${label}`,
      label: `Prepaid ${label}`,
      shortLabel: 'Prepaid',
      kind: 'PPM',
      percentRemaining: percent,
      // Expiring soon outranks how many are left — unused visits about to
      // vanish are the single cheapest reason to book a return visit.
      tone: expiringSoon ? 'WARNING' : toneForPercent(percent, remaining > 0),
      active: remaining > 0,
      primary: `${remaining} left`,
      secondary: `of ${v.total}`,
      detail: expiringSoon
        ? `Expires in ${daysToExpiry} days with ${remaining} visit${remaining === 1 ? '' : 's'} unused. They already paid for these.`
        : remaining > 0
          ? `${remaining} of ${v.total} prepaid visits remaining.`
          : 'All prepaid visits used.',
    })
  }

  return kinds ? segments.filter((s) => kinds.includes(s.kind)) : segments
}

// ===========================================================================

export interface EasyYesReason {
  key: string
  label: string
  /** Higher shows first. */
  weight: number
  tone: 'COVERED' | 'SAFETY' | 'VALUE' | 'CONTEXT'
}

/**
 * Why an advisor should expect a yes.
 *
 * Ordered by what actually moves a customer: money they don't owe first,
 * safety second, everything else after.
 */
export function easyYesReasons(o: Opportunity): EasyYesReason[] {
  const reasons: EasyYesReason[] = []
  const covered = o.likelyPayer !== 'CUSTOMER_PAY'

  if (o.likelyPayer === 'OEM_RECALL') {
    reasons.push({ key: 'recall', label: 'Manufacturer pays', weight: 100, tone: 'COVERED' })
  } else if (o.likelyPayer === 'PPM') {
    reasons.push({ key: 'prepaid', label: 'Already paid for', weight: 95, tone: 'COVERED' })
  } else if (covered && o.customerOutOfPocket === 0) {
    reasons.push({ key: 'free', label: 'Customer pays nothing', weight: 90, tone: 'COVERED' })
  } else if (covered && o.estimatedAmount > 0 && o.customerOutOfPocket / o.estimatedAmount <= 0.25) {
    reasons.push({
      key: 'mostly',
      label: `Only $${Math.round(o.customerOutOfPocket)} to them`,
      weight: 80,
      tone: 'COVERED',
    })
  }

  if (o.urgency === 'SAFETY') {
    reasons.push({ key: 'safety', label: 'Safety item', weight: 98, tone: 'SAFETY' })
  }
  if (o.type === 'DECLINED_SERVICE') {
    reasons.push({ key: 'declined', label: 'Declined before', weight: 30, tone: 'CONTEXT' })
  }
  if (o.closeProbability >= 0.7) {
    reasons.push({ key: 'likely', label: 'High close rate', weight: 60, tone: 'VALUE' })
  }
  if (o.type === 'WEAR_PREDICTED') {
    reasons.push({ key: 'measured', label: 'Measured, not guessed', weight: 55, tone: 'VALUE' })
  }

  return reasons.sort((a, b) => b.weight - a.weight)
}

// ===========================================================================

/**
 * Store gross on a sold job.
 *
 * Uses the same 55/45 labour-parts split the coverage engine assumes, at
 * industry-typical gross margins. Approximate on purpose — it exists to rank
 * and motivate, not to reconcile to the accounting.
 */
const LABOR_SHARE = 0.55
const PARTS_SHARE = 0.45
const LABOR_GROSS_MARGIN = 0.72
const PARTS_GROSS_MARGIN = 0.4

export function estimateGross(amount: number): number {
  if (amount <= 0) return 0
  return Math.round(amount * (LABOR_SHARE * LABOR_GROSS_MARGIN + PARTS_SHARE * PARTS_GROSS_MARGIN))
}

// ===========================================================================

/**
 * Where a line stands with the customer.
 *
 * CALL_ME is the customer's own answer and is neither an approval nor a
 * refusal. SKIPPED is the advisor's — they ran out of time or judged it not
 * worth raising — and means nobody was asked, which is a different thing again.
 */
export type OpportunityDecision =
  | 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CALL_ME' | 'SKIPPED'

export interface RunningTotals {
  /** Everything still on the table, plus everything already accepted. */
  opportunityValue: number
  acceptedValue: number
  acceptedGross: number
  acceptedCustomerOwes: number
  acceptedCovered: number
  declinedValue: number
  remainingValue: number
  remainingGross: number
  pendingCount: number
  acceptedCount: number
  declinedCount: number
}

/** Live totals as an advisor works the list. */
export function computeRunningTotals(
  opportunities: Opportunity[],
  decisions: Record<string, OpportunityDecision>,
): RunningTotals {
  const totals: RunningTotals = {
    opportunityValue: 0,
    acceptedValue: 0,
    acceptedGross: 0,
    acceptedCustomerOwes: 0,
    acceptedCovered: 0,
    declinedValue: 0,
    remainingValue: 0,
    remainingGross: 0,
    pendingCount: 0,
    acceptedCount: 0,
    declinedCount: 0,
  }

  for (const o of opportunities) {
    const decision = decisions[o.id] ?? 'PENDING'
    totals.opportunityValue += o.estimatedAmount

    if (decision === 'ACCEPTED') {
      totals.acceptedValue += o.estimatedAmount
      totals.acceptedGross += estimateGross(o.estimatedAmount)
      totals.acceptedCustomerOwes += o.customerOutOfPocket
      totals.acceptedCovered += Math.max(0, o.estimatedAmount - o.customerOutOfPocket)
      totals.acceptedCount += 1
    } else if (decision === 'DECLINED') {
      totals.declinedValue += o.estimatedAmount
      totals.declinedCount += 1
    } else if (decision === 'PENDING') {
      // Skipped items are set aside deliberately, so they stop counting as
      // still-winnable — otherwise the "remaining" figure never goes down.
      totals.remainingValue += o.estimatedAmount
      totals.remainingGross += estimateGross(o.estimatedAmount)
      totals.pendingCount += 1
    }
  }

  return totals
}

/** Last six of a VIN — what an advisor reads aloud and writes on a key tag. */
export function vinLastSix(vin: string): string {
  return vin.length <= 6 ? vin : vin.slice(-6)
}

/**
 * Product pitches are advisor prompts, not lines on a service menu.
 *
 * Listing "service contract, $2,400" beside a tire rotation inflates the
 * customer's apparent bill and muddles two different conversations. The
 * advisor still sees them; the customer-facing menu does not.
 */
const ADVISOR_ONLY_TYPES = new Set(['WARRANTY_EXPIRING', 'CONTRACT_UPSELL'])

export function isCustomerFacing(o: Opportunity): boolean {
  return !ADVISOR_ONLY_TYPES.has(o.type)
}

/** Detail text safe to show a customer. */
export function customerDetail(o: Opportunity): string {
  return o.customerDetail ?? o.detail
}
