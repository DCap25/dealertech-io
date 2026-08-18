import type { Opportunity } from '@/lib/prep-sheet'
import { isCustomerFacing } from '@/lib/prep-sheet/presentation'

/**
 * What the customer actually sees.
 *
 * Until now the customer menu was an implicit filter — everything
 * customer-facing that the advisor had not skipped. That works, but it means
 * the advisor curates by deciding in the advisor view and hoping the right
 * things fall out. This makes the menu a thing they build and look at before
 * anyone hands over a tablet.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE ADVISOR CANNOT CHANGE
 * ---------------------------------------------------------------------------
 * Which tier an item sits in. Tier comes from measured urgency — a tyre at
 * 2/32" is in "needs attention now" because of the number the technician
 * wrote down, not because anyone decided it should be.
 *
 * If an advisor could promote an item into that tier, the tier would stop
 * meaning anything, and the customer would be right to stop believing it. They
 * can include an item, exclude it, or move it within its own tier. That is
 * the whole vocabulary.
 */

export type MenuTier = 'NOW' | 'SOON' | 'PLANNED'

export const TIER_ORDER: MenuTier[] = ['NOW', 'SOON', 'PLANNED']

export const TIER_COPY: Record<MenuTier, { title: string; blurb: string }> = {
  NOW: {
    title: 'Needs attention now',
    blurb: 'Measured at or past the point the manufacturer sets.',
  },
  SOON: {
    title: 'Coming up soon',
    blurb: 'Still serviceable. Worth planning rather than reacting to.',
  },
  PLANNED: {
    title: 'Scheduled maintenance',
    blurb: 'On the maker’s schedule for your mileage.',
  },
}

/** Derived from urgency, never from a choice. */
export function tierOf(o: Opportunity): MenuTier {
  if (o.urgency === 'SAFETY') return 'NOW'
  if (o.urgency === 'HIGH') return 'SOON'
  return 'PLANNED'
}

/**
 * The advisor's curation.
 *
 * Stored as an ordered list of included ids rather than a set, because order
 * within a tier is part of what they are choosing. Anything absent is
 * excluded — a menu is what you decided to show, not what you failed to hide.
 */
export interface MenuSelection {
  includedIds: string[]
}

export interface MenuItem {
  opportunity: Opportunity
  tier: MenuTier
}

export interface BuiltMenu {
  tiers: { tier: MenuTier; items: MenuItem[] }[]
  /** Flat, in presentation order. */
  items: MenuItem[]
  excluded: MenuItem[]
  customerTotal: number
  coveredTotal: number
  /** Nothing to present. The advisor gets told rather than handing over a blank screen. */
  isEmpty: boolean
}

/**
 * Everything the customer could be shown, whether or not it is selected.
 *
 * Excludes items that were never for the customer in the first place — an
 * internal VSC upsell prompt is an instruction to the advisor, and turning the
 * tablet around should not reveal it.
 */
export function presentableItems(opportunities: Opportunity[]): MenuItem[] {
  return opportunities
    .filter(isCustomerFacing)
    .map((opportunity) => ({ opportunity, tier: tierOf(opportunity) }))
}

/**
 * The starting point: everything presentable, minus anything already skipped,
 * minus anything we have not verified.
 *
 * Deliberately opt-out for the rest. An advisor who taps straight through gets
 * the same menu the product produced before this step existed, so curation is
 * a thing they can do rather than a thing they must do before a customer is
 * served.
 *
 * The exception is items the engine flagged `unverified` — interval services
 * with no record on file. Those are on the sheet as questions for the advisor,
 * and an older vehicle with no history can carry half a dozen. Defaulting them
 * on would put a page of "you may be due for this" in front of a customer, on
 * the strength of a gap in our own records. They appear in the builder
 * unchecked, so the advisor sees them and ticks the ones they have actually
 * asked about.
 */
export function defaultSelection(
  opportunities: Opportunity[],
  skippedIds: string[] = [],
): MenuSelection {
  const skipped = new Set(skippedIds)
  const items = presentableItems(opportunities)
    .filter((i) => !skipped.has(i.opportunity.id))
    .filter((i) => !i.opportunity.unverified)
    /*
      Nothing the dealership cannot bill at that price.

      A price the store has no op code for is our estimate, and the whole
      reason the price book is pulled every morning is that we must not quote a
      number the DMS will not charge. Showing a customer $84 and invoicing $106
      is the argument this product exists to prevent, and it does not matter
      that our figure was reasonable.

      The recommendation is not thrown away — it stays on the advisor's sheet,
      marked, so they can map the op code or price it themselves. It simply
      does not go in front of a customer as a number by default.
    */
    .filter((i) => i.opportunity.priceSource !== 'ESTIMATE')

  // Ranked the way the prep sheet ranked them, tier first. The engine already
  // decided what matters most; the advisor is editing that, not redoing it.
  const ordered = [...items].sort((a, b) => {
    const byTier = TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)
    if (byTier !== 0) return byTier
    return b.opportunity.priorityScore - a.opportunity.priorityScore
  })

  return { includedIds: ordered.map((i) => i.opportunity.id) }
}

export function isIncluded(selection: MenuSelection, id: string): boolean {
  return selection.includedIds.includes(id)
}

/**
 * Take a line off the menu or put it back.
 *
 * A re-included id goes on the end, and stays there: it left the menu and comes
 * back as the newest member of its tier, which is where every surface draws it,
 * because they all group by tier before they read this order. Putting it back
 * where it was would mean remembering a position this function was never told.
 * `move` no longer cares where in the list it lands.
 */
export function toggle(selection: MenuSelection, id: string): MenuSelection {
  return isIncluded(selection, id)
    ? { includedIds: selection.includedIds.filter((x) => x !== id) }
    : { includedIds: [...selection.includedIds, id] }
}

/**
 * Move an item one place within its own tier.
 *
 * Refuses to cross a tier boundary rather than clamping silently: an advisor
 * pressing "up" on the first item of a tier should see nothing happen, not
 * watch it jump into a more urgent group.
 *
 * ---------------------------------------------------------------------------
 * WHY IT SEARCHES FOR ITS TIER-MATE INSTEAD OF LOOKING NEXT DOOR
 * ---------------------------------------------------------------------------
 * This used to compare the item with whatever sat beside it in `includedIds`
 * and refuse if that neighbour was in another tier — which assumed the list is
 * always grouped by tier. It is not. `toggle` puts a re-included id back at the
 * end, and `includeAll` rebuilds the list in priority order, where a $3,000
 * "coming up soon" job legitimately outranks a safety item. Either one leaves
 * tiers interleaved, and then every arrow in the affected tiers went dead: the
 * guard saw a cross-tier neighbour and refused, correctly by its own logic, at
 * an advisor who had done nothing but untick a line and tick it back.
 *
 * So the item now swaps with the next id *of its own tier* in that direction,
 * however far away it happens to be. Nothing between the two moves, and
 * everything between the two is — by the way we found it — from other tiers,
 * so those tiers' internal order is untouched: their members' positions
 * relative to each other never change. Within the moving tier the two ids are
 * neighbours, which is exactly the one-place step the advisor asked for.
 *
 * Refusal survives, and now means what it says: no tier-mate that way, so the
 * item is already at the top or bottom of its group.
 */
export function move(
  selection: MenuSelection,
  all: MenuItem[],
  id: string,
  direction: -1 | 1,
): MenuSelection {
  const byId = new Map(all.map((i) => [i.opportunity.id, i]))
  const ids = [...selection.includedIds]
  const from = ids.indexOf(id)
  if (from === -1) return selection

  // An id the sheet no longer carries has no tier to stay inside, so there is
  // no move that could be within it. The selection outlives the sheet.
  const tier = byId.get(id)?.tier
  if (!tier) return selection

  let to = from + direction
  while (to >= 0 && to < ids.length && byId.get(ids[to]!)?.tier !== tier) to += direction
  if (to < 0 || to >= ids.length) return selection

  ;[ids[from], ids[to]] = [ids[to]!, ids[from]!]
  return { includedIds: ids }
}

export function includeAll(all: MenuItem[]): MenuSelection {
  return { includedIds: all.map((i) => i.opportunity.id) }
}

export function excludeAll(): MenuSelection {
  return { includedIds: [] }
}

/**
 * Assemble the menu the customer will see.
 *
 * Order comes from the selection; grouping comes from the tier. An id in the
 * selection that no longer exists on the sheet is dropped rather than throwing
 * — a prep sheet can be rebuilt underneath a stale selection.
 */
export function buildMenu(
  opportunities: Opportunity[],
  selection: MenuSelection,
): BuiltMenu {
  const all = presentableItems(opportunities)
  const byId = new Map(all.map((i) => [i.opportunity.id, i]))

  const items = selection.includedIds
    .map((id) => byId.get(id))
    .filter((i): i is MenuItem => Boolean(i))

  const includedIds = new Set(items.map((i) => i.opportunity.id))
  const excluded = all.filter((i) => !includedIds.has(i.opportunity.id))

  const tiers = TIER_ORDER.map((tier) => ({
    tier,
    items: items.filter((i) => i.tier === tier),
  })).filter((group) => group.items.length > 0)

  return {
    tiers,
    items,
    excluded,
    /*
      Totals count only what the dealership can actually bill at that price.

      An item priced from our own estimate reads "price to be confirmed" to the
      customer, so adding our figure into the total underneath it would put the
      unhonourable number straight back on the screen by another route.
    */
    customerTotal: items
      .filter((i) => i.opportunity.priceSource !== 'ESTIMATE')
      .reduce((s, i) => s + i.opportunity.customerOutOfPocket, 0),
    coveredTotal: items
      .filter((i) => i.opportunity.priceSource !== 'ESTIMATE')
      .reduce(
        (s, i) => s + Math.max(0, i.opportunity.estimatedAmount - i.opportunity.customerOutOfPocket),
        0,
      ),
    isEmpty: items.length === 0,
  }
}

/**
 * Things worth saying before the tablet is handed over.
 *
 * Not blocking. An advisor has reasons we do not know about — the customer
 * already declined it in the lane, or it is going on a different visit — and a
 * system that refuses to proceed teaches them to work around it.
 */
export function menuWarnings(menu: BuiltMenu): string[] {
  const out: string[] = []

  const excludedSafety = menu.excluded.filter((i) => i.opportunity.urgency === 'SAFETY')
  if (excludedSafety.length > 0) {
    out.push(
      excludedSafety.length === 1
        ? `${excludedSafety[0]!.opportunity.title} is a safety item and is not on the menu.`
        : `${excludedSafety.length} safety items are not on the menu.`,
    )
  }

  const excludedFree = menu.excluded.filter((i) => i.opportunity.customerOutOfPocket === 0)
  if (excludedFree.length > 0) {
    out.push(
      `${excludedFree.length} item${excludedFree.length === 1 ? '' : 's'} the customer owes nothing for ${
        excludedFree.length === 1 ? 'is' : 'are'
      } not on the menu.`,
    )
  }

  return out
}
