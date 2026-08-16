/**
 * What DealerTech costs.
 *
 * ---------------------------------------------------------------------------
 * THE UNIT IS THE ROOFTOP
 * ---------------------------------------------------------------------------
 * Not the seat. A fixed ops director budgets per rooftop and defends the line
 * item against the department's gross, which is the conversation this pricing
 * has to survive. Seats are unlimited on purpose: the prep sheet gets better
 * with every technician entering measurements and every BDC rep logging an
 * outcome, and charging per seat is a tax on exactly the adoption that makes
 * the data worth having.
 *
 * ---------------------------------------------------------------------------
 * VOLUME, NOT GRADUATED
 * ---------------------------------------------------------------------------
 * A group with eleven rooftops pays 11 × $895. It does NOT pay two at $1,195,
 * then eight at $995, then one at $895. Crossing a band re-prices the whole
 * group, which is what a dealer principal expects when they are told "eleven
 * rooftops is $895 each" — and it means growing is always rewarded rather than
 * producing an invoice nobody can reconstruct.
 *
 * ---------------------------------------------------------------------------
 * ONE STRIPE PRICE, NOT FOUR
 * ---------------------------------------------------------------------------
 * A deviation from docs/SAAS_PLAN.md §5, which proposed a price per band. Four
 * prices means the application has to notice a band crossing and swap the
 * subscription onto a different price, mid-period, with its own proration —
 * a moving part that exists only because we split something Stripe can express
 * directly. Stripe's `tiers_mode: 'volume'` takes the quantity and picks the
 * band itself, so adding a rooftop is a quantity change and nothing else.
 *
 * The bands are still here because we need our own arithmetic for the console's
 * "this will change the invoice by X" preview. A test asserts our numbers and
 * the tier table we send Stripe are the same numbers, so they cannot drift.
 *
 * Pure and I/O-free. Money is in cents throughout, matching Stripe, because a
 * dollars-versus-cents mistake in billing code is the expensive kind.
 */

/** One plan at launch. Tiers can be added without touching call sites. */
export const PLAN_KEY = 'STANDARD'

/**
 * The lookup key the application resolves the Stripe price by.
 *
 * Never a `price_...` id in code. Stripe prices are immutable — changing a
 * number means creating a new price — so hardcoding an id would mean a code
 * change every time pricing moves. A lookup key can be moved to the new price
 * in the dashboard, and the deploy that changes the number is a Stripe action
 * rather than a release.
 */
export const PRICE_LOOKUP_KEY = 'dealertech_standard_rooftop_monthly'

export interface Band {
  /** Inclusive. */
  minRooftops: number
  /** Inclusive. Null means no upper limit. */
  maxRooftops: number | null
  /** Per rooftop, per month, in cents. */
  unitAmountCents: number
  label: string
}

/**
 * The price list.
 *
 * Set 2026-08-16. These are a starting position, not research: they sit above
 * the seat-based tools a dealership already buys and below the enterprise
 * fixed-ops platforms, on the argument that this replaces more of the workflow
 * than the former and less of the infrastructure than the latter. Revisit
 * against real design-partner conversations — see docs/SAAS_PLAN.md §10.
 */
export const BANDS: Band[] = [
  { minRooftops: 1, maxRooftops: 2, unitAmountCents: 119_500, label: '1–2 rooftops' },
  { minRooftops: 3, maxRooftops: 10, unitAmountCents: 99_500, label: '3–10 rooftops' },
  { minRooftops: 11, maxRooftops: 25, unitAmountCents: 89_500, label: '11–25 rooftops' },
  { minRooftops: 26, maxRooftops: null, unitAmountCents: 79_500, label: '26+ rooftops' },
]

/**
 * Which band a group of this size falls into.
 *
 * Clamps rather than throwing. A quantity of zero is not a real subscription,
 * but it is reachable — a group whose last rooftop was deactivated while the
 * subscription is still open — and the honest answer for pricing purposes is
 * the first band, not an exception thrown from a page that was only trying to
 * render a number.
 */
export function bandFor(rooftops: number): Band {
  const n = Math.max(1, Math.floor(rooftops))
  return BANDS.find((b) => n >= b.minRooftops && (b.maxRooftops === null || n <= b.maxRooftops))
    ?? BANDS[BANDS.length - 1]!
}

/** Per rooftop, per month, in cents, at this group size. */
export function unitPriceCents(rooftops: number): number {
  return bandFor(rooftops).unitAmountCents
}

/** What the whole group pays per month, in cents. */
export function monthlyTotalCents(rooftops: number): number {
  const n = Math.max(0, Math.floor(rooftops))
  return n * unitPriceCents(n)
}

/**
 * The tier table Stripe needs, derived from the same bands.
 *
 * Derived rather than written twice — this is the whole reason the drift test
 * can exist. `up_to` is the inclusive upper bound of each tier, and the last
 * one is unbounded.
 */
export function stripeTiers(): { up_to: number | 'inf'; unit_amount: number }[] {
  return BANDS.map((b) => ({
    up_to: b.maxRooftops === null ? ('inf' as const) : b.maxRooftops,
    unit_amount: b.unitAmountCents,
  }))
}

/** Dollars, for a screen. Never used to compute anything. */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  })
}

export interface ChangePreview {
  fromRooftops: number
  toRooftops: number
  fromMonthlyCents: number
  toMonthlyCents: number
  /** Positive when the invoice goes up. */
  differenceCents: number
  /** Set when the change moves the group into a different band. */
  bandChange: { from: string; to: string } | null
}

/**
 * What changing the rooftop count does to the monthly invoice.
 *
 * For the console, so a support engineer adding a rooftop sees the consequence
 * before they commit it. Stripe's proration is authoritative for the *next
 * invoice*; this is the steady-state monthly figure, which is the number
 * somebody actually wants when they ask "what will this cost them".
 *
 * The band-crossing case is called out separately because it is the one that
 * surprises people: a group going from ten rooftops to eleven adds a rooftop
 * and their per-rooftop price drops, so the invoice rises by less than one
 * rooftop's worth. That reads as a bug unless the screen says why.
 */
export function previewChange(fromRooftops: number, toRooftops: number): ChangePreview {
  const fromBand = bandFor(fromRooftops)
  const toBand = bandFor(toRooftops)
  const fromMonthlyCents = monthlyTotalCents(fromRooftops)
  const toMonthlyCents = monthlyTotalCents(toRooftops)

  return {
    fromRooftops,
    toRooftops,
    fromMonthlyCents,
    toMonthlyCents,
    differenceCents: toMonthlyCents - fromMonthlyCents,
    bandChange: fromBand === toBand ? null : { from: fromBand.label, to: toBand.label },
  }
}
