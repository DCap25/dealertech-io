/**
 * What a recommendation costs at this dealership.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS FIXES
 * ---------------------------------------------------------------------------
 * Every price a customer was quoted came from a constant in the engine — $84
 * for an oil change, $618 for front brakes, $149 for an alignment — while the
 * store's actual op codes sat in a table nobody read. Three things followed:
 *
 *   - The morning price sync had no effect on anything a customer was quoted.
 *     It updated op codes; the menu ignored them.
 *   - The menu and the repair order could disagree. A customer agreed to $84
 *     from a constant, then the advisor added the LOF op code at whatever it
 *     actually costs.
 *   - Every dealership was quoted the same numbers regardless of their market,
 *     their labour rate, or what they charge.
 *
 * ---------------------------------------------------------------------------
 * HOW A PRICE IS RESOLVED
 * ---------------------------------------------------------------------------
 * By op code, because a component group is not specific enough — front and
 * rear brakes share BRAKE_PADS_SHOES and cost different money. Each thing the
 * engine can recommend names the op code it means.
 *
 * The engine's constant remains as a fallback, and that is deliberate rather
 * than lazy: a store that has not mapped a code still needs a number, and a
 * recommendation that silently disappears because its price is missing is
 * worse than one priced approximately. Which happened is recorded on the
 * opportunity, so an advisor can tell "your price" from "our estimate".
 *
 * Pure and I/O-free.
 */

export interface PricedOperation {
  code: string
  description: string
  laborAmount: number
  partsAmount: number
}

/** The store's priced operations, keyed by op code. */
export type PriceBook = Record<string, PricedOperation>

export type PriceSource = 'STORE' | 'ESTIMATE'

export interface ResolvedPrice {
  amount: number
  source: PriceSource
  /** Set when the store's own op code supplied the number. */
  opCode: string | null
}

/**
 * The price for one recommendation.
 *
 * `fallback` is the engine's own figure, used when the store has no matching
 * op code or has deactivated it.
 */
export function resolvePrice(
  book: PriceBook | undefined,
  opCode: string | undefined,
  fallback: number,
): ResolvedPrice {
  if (!book || !opCode) return { amount: fallback, source: 'ESTIMATE', opCode: null }

  const priced = book[opCode]
  if (!priced) return { amount: fallback, source: 'ESTIMATE', opCode: null }

  const amount = priced.laborAmount + priced.partsAmount

  /*
    A zero-priced op code falls back rather than quoting nothing.

    Some operations genuinely are free — a multi-point inspection — but those
    are not the ones the engine recommends and charges for. A zero here is far
    more often a code that exists with its pricing not filled in, and quoting a
    brake job at no charge is a worse failure than quoting an estimate.
  */
  if (amount <= 0) return { amount: fallback, source: 'ESTIMATE', opCode: null }

  return { amount, source: 'STORE', opCode }
}

/** Built from whatever the DMS price book pull returned. */
export function toPriceBook(operations: PricedOperation[]): PriceBook {
  const book: PriceBook = {}
  for (const op of operations) {
    if (!op.code) continue
    book[op.code] = op
  }
  return book
}
