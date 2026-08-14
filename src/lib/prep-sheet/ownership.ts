import { differenceInCalendarDays, differenceInCalendarMonths } from 'date-fns'
import type { Contract } from '@/lib/coverage'
import type { Opportunity, PrepSheet } from './types'

/**
 * What the customer already owns.
 *
 * Pure and I/O-free. This is the single highest-leverage fact on a prep sheet:
 * most stores cannot answer "what protection did this person buy" at the
 * drive, so advisors sell work the customer had already paid to have covered,
 * and customers pay twice for the same repair.
 *
 * Deliberately separate from the factory warranty rings. "What the
 * manufacturer covers" and "what they bought from us" are different thoughts,
 * and merging them into one row is why ownership gets missed.
 */

export type OwnedProductKind =
  | 'VSC'
  | 'PPM'
  | 'TIRE_WHEEL'
  | 'PDR'
  | 'WINDSHIELD'
  | 'KEY'
  | 'APPEARANCE'
  | 'THEFT'
  | 'GAP'
  | 'OTHER'

interface ProductMeta {
  label: string
  glyph: string
  /** Higher shows first — ordered by how often it changes today's answer. */
  weight: number
}

const PRODUCT_META: Record<OwnedProductKind, ProductMeta> = {
  // A service contract can pay for the most expensive thing on the sheet.
  VSC: { label: 'Service Contract', glyph: '§', weight: 100 },
  // Prepaid visits expire unused more than any other product.
  PPM: { label: 'Prepaid Maintenance', glyph: '⌛', weight: 95 },
  TIRE_WHEEL: { label: 'Tire & Wheel', glyph: '◎', weight: 90 },
  PDR: { label: 'Dent & Ding', glyph: '◆', weight: 70 },
  WINDSHIELD: { label: 'Windshield', glyph: '▢', weight: 65 },
  KEY: { label: 'Key Replacement', glyph: '⚿', weight: 55 },
  APPEARANCE: { label: 'Appearance', glyph: '✦', weight: 50 },
  THEFT: { label: 'Theft', glyph: '⊗', weight: 40 },
  GAP: { label: 'GAP', glyph: '≈', weight: 30 },
  OTHER: { label: 'Protection', glyph: '•', weight: 20 },
}

/** DMS and seed vocabularies both appear; normalise once, here. */
const KIND_ALIASES: Record<string, OwnedProductKind> = {
  VSC: 'VSC',
  PPM: 'PPM',
  TIRE_WHEEL: 'TIRE_WHEEL',
  PDR: 'PDR',
  DENT: 'PDR',
  WINDSHIELD: 'WINDSHIELD',
  KEY: 'KEY',
  APPEARANCE: 'APPEARANCE',
  THEFT: 'THEFT',
  GAP: 'GAP',
}

export function toOwnedKind(productType: string): OwnedProductKind {
  return KIND_ALIASES[productType] ?? 'OTHER'
}

export interface OwnedProduct {
  key: string
  kind: OwnedProductKind
  label: string
  glyph: string
  adminCompany: string
  /** "Exclusionary Platinum" or similar, when the contract carries one. */
  tier: string | null
  /** "42 mo left", "3 of 6 visits", "Expired". */
  headline: string
  /** Supporting facts: deductible, mileage remaining, tread minimum. */
  facts: string[]
  active: boolean
  /** True when it lapses inside the next 90 days and still has value. */
  expiringSoon: boolean
  /** Something the advisor can say out loud. */
  talkTrack: string
  claimPhone: string | null
  requiresPriorAuthorization: boolean
  weight: number
}

export interface OwnershipSummary {
  products: OwnedProduct[]
  activeCount: number
  /** Products lapsing soon with value left — the reason to act today. */
  expiringCount: number
  /** One line for the advisor when there is nothing on file. */
  emptyNote: string | null
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

/** Months and miles left, whichever the contract actually limits on. */
function termRemaining(
  contract: Contract,
  currentMileage: number,
  asOf: Date,
): { months: number | null; miles: number | null } {
  const end =
    contract.expirationDate ??
    (contract.termMonths
      ? new Date(contract.purchaseDate.getTime() + contract.termMonths * 30.44 * 86_400_000)
      : null)

  const limitMiles = contract.expirationMiles ?? contract.termMiles

  return {
    months: end ? differenceInCalendarMonths(end, asOf) : null,
    miles: limitMiles === null || limitMiles === undefined ? null : limitMiles - currentMileage,
  }
}

/**
 * Prepaid plans are counted in visits, not months.
 *
 * A plan with time left and no visits left is worthless; a plan with visits
 * left and two weeks on the clock is the cheapest booking in the store.
 */
function prepaidHeadline(
  entitlements: PrepSheet['prepaidEntitlements'],
): { headline: string; remaining: number; total: number } {
  let remaining = 0
  let total = 0
  for (const e of entitlements) {
    remaining += Math.max(0, e.totalAllowed - e.used)
    total += e.totalAllowed
  }
  return {
    headline: total === 0 ? 'No visits on file' : `${remaining} of ${total} visits left`,
    remaining,
    total,
  }
}

const EXPIRING_WINDOW_DAYS = 90

export function summarizeOwnership(sheet: PrepSheet, asOf: Date = new Date()): OwnershipSummary {
  const products: OwnedProduct[] = []
  const mileage = sheet.projectedMileage

  for (const contract of sheet.contracts) {
    const kind = toOwnedKind(contract.productType)
    const meta = PRODUCT_META[kind]
    const active = contract.status === 'ACTIVE'
    const { months, miles } = termRemaining(contract, mileage, asOf)

    const facts: string[] = []
    if (contract.deductibleAmount > 0) {
      facts.push(`${money(contract.deductibleAmount)} deductible`)
    } else if (active) {
      facts.push('No deductible')
    }
    if (miles !== null && miles > 0) facts.push(`${miles.toLocaleString()} mi left`)
    if (contract.minimumTreadDepth32nds) {
      // The single most common reason a tire & wheel claim is denied.
      facts.push(`Needs ${contract.minimumTreadDepth32nds}/32" tread`)
    }
    if (contract.perTireLimit) facts.push(`${money(contract.perTireLimit)} per tire`)
    if (contract.requiresPriorAuthorization) facts.push('Prior auth required')

    let headline: string
    if (!active) headline = 'Expired'
    else if (kind === 'PPM') headline = prepaidHeadline(sheet.prepaidEntitlements).headline
    else if (months !== null) headline = `${Math.max(0, months)} mo left`
    else headline = 'Active'

    const daysLeft =
      contract.expirationDate === undefined
        ? null
        : differenceInCalendarDays(contract.expirationDate, asOf)

    const prepaid = prepaidHeadline(sheet.prepaidEntitlements)
    const hasValueLeft = kind === 'PPM' ? prepaid.remaining > 0 : true
    const expiringSoon =
      active && hasValueLeft && daysLeft !== null && daysLeft >= 0 && daysLeft <= EXPIRING_WINDOW_DAYS

    products.push({
      key: `owned:${contract.id}`,
      kind,
      label: meta.label,
      glyph: meta.glyph,
      adminCompany: contract.adminCompany,
      tier: contract.coverageTier ?? null,
      headline,
      facts,
      active,
      expiringSoon,
      talkTrack: talkTrackFor(kind, contract, {
        active,
        expiringSoon,
        prepaidRemaining: prepaid.remaining,
      }),
      claimPhone: contract.claimPhone ?? null,
      requiresPriorAuthorization: contract.requiresPriorAuthorization,
      weight: meta.weight + (expiringSoon ? 5 : 0),
    })
  }

  products.sort((a, b) => {
    // Active before expired, then by how much the product matters today.
    if (a.active !== b.active) return a.active ? -1 : 1
    return b.weight - a.weight
  })

  const activeCount = products.filter((p) => p.active).length

  return {
    products,
    activeCount,
    expiringCount: products.filter((p) => p.expiringSoon).length,
    emptyNote:
      products.length === 0
        ? 'No purchased protection on file. Anything beyond factory warranty is customer pay today — and their coverage ending is the moment a service contract is easiest to justify.'
        : null,
  }
}

function talkTrackFor(
  kind: OwnedProductKind,
  contract: Contract,
  state: { active: boolean; expiringSoon: boolean; prepaidRemaining: number },
): string {
  if (!state.active) {
    return `Their ${PRODUCT_META[kind].label.toLowerCase()} has lapsed. Worth telling them plainly — customers assume these renew themselves.`
  }

  switch (kind) {
    case 'VSC':
      return contract.requiresPriorAuthorization
        ? `They own a ${contract.coverageTier ?? 'service'} contract through ${contract.adminCompany}. Say "you've got coverage on that" — then call for authorisation before any teardown, or the claim gets denied.`
        : `They own a ${contract.coverageTier ?? 'service'} contract through ${contract.adminCompany}. Lead with what they owe, not the price of the job.`
    case 'PPM':
      return state.prepaidRemaining > 0
        ? `They have ${state.prepaidRemaining} prepaid visit${state.prepaidRemaining === 1 ? '' : 's'} left. They already paid for these — using one costs them nothing and gets the car back in.`
        : 'Their prepaid plan is used up. Worth mentioning before they assume today is covered.'
    case 'TIRE_WHEEL':
      return contract.minimumTreadDepth32nds
        ? `They own tire & wheel through ${contract.adminCompany}. Road hazard only, and it needs ${contract.minimumTreadDepth32nds}/32" of tread — check the measurement before you promise anything.`
        : `They own tire & wheel through ${contract.adminCompany}. Road hazard damage is covered; ordinary wear is not.`
    case 'PDR':
      return 'They own dent & ding coverage. Walk the panels with them — most customers forget they have this until someone points at a door ding.'
    case 'WINDSHIELD':
      return 'They own windshield coverage. Worth a look at the glass while it is here; a chip today is a replacement next month.'
    case 'KEY':
      return 'They own key replacement. Mention it if they only have one key — a second key is cheap on their contract and expensive without it.'
    default:
      return `They own ${PRODUCT_META[kind].label.toLowerCase()} through ${contract.adminCompany}.`
  }
}

// ===========================================================================

/**
 * A note tying an opportunity to something the customer already owns.
 *
 * Fires where the coverage engine did NOT already route the item to that
 * product — the interesting case, because the advisor is about to quote
 * customer pay on a job the customer half-expects to be covered. Saying so
 * first is the difference between a sale and an argument at the cashier.
 */
export function ownershipHint(
  opportunity: Opportunity,
  summary: OwnershipSummary,
): string | null {
  if (opportunity.likelyPayer !== 'CUSTOMER_PAY') return null

  const group = opportunity.componentGroupKey ?? ''
  const active = summary.products.filter((p) => p.active)

  const tireWheel = active.find((p) => p.kind === 'TIRE_WHEEL')
  if (tireWheel && (group === 'TIRES' || group === 'WHEELS_RIMS')) {
    return `They own tire & wheel — this one is wear, not road hazard, so it is not covered. Say that before they ask.`
  }

  const ppm = active.find((p) => p.kind === 'PPM')
  if (ppm && (group === 'OIL_CHANGE' || group === 'TIRE_ROTATION')) {
    return 'They have a prepaid plan — check whether this visit is one of the covered services before quoting it.'
  }

  const vsc = active.find((p) => p.kind === 'VSC')
  if (vsc && opportunity.type === 'WEAR_PREDICTED') {
    return 'They own a service contract, but wear items are excluded from every one of them. Worth naming so it does not come up later.'
  }

  return null
}
