/**
 * Deciding what a morning price pull is allowed to change.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT JUST AN UPSERT
 * ---------------------------------------------------------------------------
 * A job that runs unattended at six in the morning and rewrites every price the
 * dealership quotes is one bad payload away from doing real damage. By the time
 * anybody notices, advisors have been quoting the wrong numbers for hours and
 * some of those quotes are sitting in customers' inboxes.
 *
 * The failures worth designing against are not exotic:
 *
 *   - The pull half-works. A timeout mid-page returns 4 op codes instead of
 *     400, and a naive sync deactivates the other 396.
 *   - The pull returns nothing. An expired credential looks exactly like "this
 *     dealership has no op codes", and the difference is the entire price book.
 *   - A field arrives in cents. Every price is suddenly a hundred times larger,
 *     and a $618 brake job is presented to a customer as $61,800.
 *
 * None of those are detectable from a single row. They are only visible in the
 * shape of the whole batch, which is why this takes the batch and returns a
 * plan rather than applying rows as they arrive.
 *
 * Pure and I/O-free. The runner applies the plan and records what happened.
 */

/** One priced operation as the DMS reports it. */
export interface IncomingPrice {
  code: string
  description: string
  laborHours: number | null
  laborAmount: number | null
  partsAmount: number | null
}

/** What we already hold for that code. */
export interface ExistingPrice {
  id: string
  code: string
  description: string
  laborHours: number | null
  laborAmount: number | null
  partsAmount: number | null
  isActive: boolean
}

export interface PriceChange {
  id: string
  code: string
  description: string
  before: { laborHours: number | null; laborAmount: number | null; partsAmount: number | null }
  after: { laborHours: number | null; laborAmount: number | null; partsAmount: number | null }
  /** Total price movement, for reporting and for the sanity check. */
  beforeTotal: number
  afterTotal: number
}

export interface SyncPlan {
  /** Codes we have never seen. */
  create: IncomingPrice[]
  /** Codes whose price moved. */
  update: PriceChange[]
  /** Held codes the DMS no longer lists. Deactivated, never deleted. */
  deactivate: ExistingPrice[]
  /** Reactivated because the DMS listed them again. */
  reactivate: ExistingPrice[]
  /** Changes withheld because they look like a units error rather than a price. */
  quarantined: PriceChange[]
  unchanged: number
}

export type SyncRefusal =
  | { kind: 'EMPTY_PULL'; message: string }
  | { kind: 'SUSPICIOUS_SHRINKAGE'; message: string }

export type SyncDecision =
  | { ok: true; plan: SyncPlan }
  | { ok: false; refusal: SyncRefusal }

/**
 * How much of the book may vanish in one night before we stop believing it.
 *
 * Twenty per cent. A dealership genuinely retiring a fifth of its op codes
 * overnight is not a thing that happens; a partial pull that returns four
 * fifths of them is. Wrong in the cautious direction costs a manual re-run —
 * wrong in the other direction empties the menu.
 */
const MAX_SHRINKAGE = 0.2

/**
 * How far a single price may move before it is treated as a units error.
 *
 * Ten times. Real price rises are single-digit percentages and even a supplier
 * shock is not an order of magnitude; a hundredfold jump is cents being read as
 * dollars. Ten is comfortably above any real movement and comfortably below the
 * smallest units mistake anyone makes.
 */
const IMPLAUSIBLE_FACTOR = 10

function total(p: { laborAmount: number | null; partsAmount: number | null }): number {
  return (p.laborAmount ?? 0) + (p.partsAmount ?? 0)
}

function differs(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a !== b
  // Prices are stored to two decimals; anything finer is float noise.
  return Math.abs(a - b) >= 0.005
}

/**
 * Is this movement a price change or a units error?
 *
 * Only judged when there is something to compare against. A code going from
 * free to priced, or priced to free, is a real editorial decision somebody made
 * in the DMS and not something to second-guess.
 */
function implausible(beforeTotal: number, afterTotal: number): boolean {
  if (beforeTotal <= 0 || afterTotal <= 0) return false
  const ratio = afterTotal > beforeTotal ? afterTotal / beforeTotal : beforeTotal / afterTotal
  return ratio >= IMPLAUSIBLE_FACTOR
}

/**
 * Work out what to apply.
 *
 * Refuses outright rather than applying a partial plan, because a half-applied
 * price book is harder to reason about than one that did not change at all.
 */
export function planPriceSync(
  incoming: IncomingPrice[],
  existing: ExistingPrice[],
): SyncDecision {
  const held = existing.filter((e) => e.isActive)

  /*
    Nothing came back.

    Only a refusal when we hold something. A brand-new store legitimately has an
    empty book and a first sync that finds nothing is not a failure, just a
    quiet morning.
  */
  if (incoming.length === 0) {
    if (held.length === 0) {
      return { ok: true, plan: emptyPlan() }
    }
    return {
      ok: false,
      refusal: {
        kind: 'EMPTY_PULL',
        message:
          `The DMS returned no operations while ${held.length} are on file. That is what an ` +
          `expired credential looks like, so nothing was changed.`,
      },
    }
  }

  const byCode = new Map(existing.map((e) => [e.code, e]))
  const incomingCodes = new Set(incoming.map((i) => i.code))

  const missing = held.filter((e) => !incomingCodes.has(e.code))
  if (held.length > 0 && missing.length / held.length > MAX_SHRINKAGE) {
    return {
      ok: false,
      refusal: {
        kind: 'SUSPICIOUS_SHRINKAGE',
        message:
          `The pull is missing ${missing.length} of ${held.length} operations on file ` +
          `(${Math.round((missing.length / held.length) * 100)}%). A partial pull looks exactly ` +
          `like this, so nothing was changed.`,
      },
    }
  }

  const plan = emptyPlan()

  for (const row of incoming) {
    const current = byCode.get(row.code)
    if (!current) {
      plan.create.push(row)
      continue
    }

    if (!current.isActive) plan.reactivate.push(current)

    const moved =
      differs(current.laborHours, row.laborHours) ||
      differs(current.laborAmount, row.laborAmount) ||
      differs(current.partsAmount, row.partsAmount)

    if (!moved) {
      plan.unchanged += 1
      continue
    }

    const change: PriceChange = {
      id: current.id,
      code: current.code,
      description: row.description,
      before: {
        laborHours: current.laborHours,
        laborAmount: current.laborAmount,
        partsAmount: current.partsAmount,
      },
      after: {
        laborHours: row.laborHours,
        laborAmount: row.laborAmount,
        partsAmount: row.partsAmount,
      },
      beforeTotal: total(current),
      afterTotal: total(row),
    }

    if (implausible(change.beforeTotal, change.afterTotal)) {
      // Held back rather than applied. The old price is wrong-ish at worst;
      // the new one is wrong by two orders of magnitude in front of a customer.
      plan.quarantined.push(change)
    } else {
      plan.update.push(change)
    }
  }

  plan.deactivate = missing
  return { ok: true, plan }
}

function emptyPlan(): SyncPlan {
  return {
    create: [], update: [], deactivate: [], reactivate: [], quarantined: [], unchanged: 0,
  }
}

/** One line an operator can read at a glance. */
export function describePlan(plan: SyncPlan): string {
  const parts = [
    `${plan.update.length} repriced`,
    `${plan.create.length} new`,
    `${plan.deactivate.length} retired`,
    `${plan.unchanged} unchanged`,
  ]
  if (plan.reactivate.length > 0) parts.push(`${plan.reactivate.length} reactivated`)
  if (plan.quarantined.length > 0) parts.push(`${plan.quarantined.length} HELD BACK`)
  return parts.join(', ')
}
