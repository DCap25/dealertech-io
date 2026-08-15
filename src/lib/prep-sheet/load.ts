import 'server-only'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/db/client'
import { withCurrentUserScope } from '@/db/scoped'
import { toPrepSheetInputs, type StoreProfile } from '@/lib/dms'
import { getDmsAdapter } from '@/lib/dms/registry'
import { buildPrepSheet } from './build'
import { toPriceBook } from './pricing'
import type { PrepSheet } from './types'

/**
 * The drive, assembled from whatever DMS is configured.
 *
 * This file used to hold the queries; they now live in the adapter, and this
 * is the seam between "what the dealership's system knows" and "what our
 * engines do with it".
 */

/**
 * Store settings the engine needs for pricing and state-specific rules.
 *
 * Read from the rooftop being worked, not hardcoded. Labour rate varies by
 * store and prices every estimate on the sheet; state decides CARB hybrid
 * terms and inspection rules. A second dealership inheriting the first one's
 * door rate would quote wrong money on every line.
 *
 * Falls back only when the row is somehow missing, and to values that are
 * obviously placeholders rather than plausible ones.
 */
async function storeProfile(storeId: string): Promise<StoreProfile> {
  return withCurrentUserScope(async (db) => {
  const [row] = await db
    .select({ state: schema.stores.state, laborRate: schema.stores.laborRate })
    .from(schema.stores)
    .where(eq(schema.stores.id, storeId))
    .limit(1)

    return {
      state: row?.state ?? undefined,
      laborRate: Number(row?.laborRate ?? 0),
    }
  })
}

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

/**
 * A day of prep sheets.
 *
 * Pull from the DMS adapter, map into engine inputs, build. The data access
 * that used to live here moved into `MockDmsAdapter` unchanged, so the output
 * is identical — but the application no longer knows where the appointments
 * came from, which is the point.
 */
export async function loadDriveDay(
  storeId: string,
  day: Date,
  asOf: Date = new Date(),
): Promise<PrepSheet[]> {
  const from = startOfDay(day)
  const to = new Date(from)
  to.setDate(to.getDate() + 1)

  const adapter = getDmsAdapter()

  const [bundle, profile, priced] = await Promise.all([
    adapter.pullDriveBundle(storeId, { from, to }),
    storeProfile(storeId),
    /*
      The store's own prices.

      Pulled every drive load rather than cached, because a price the customer
      is quoted has to be the one the shop will actually bill — and the morning
      sync, or somebody editing an op code at ten o'clock, both move it. A
      stale menu price is the thing this whole change exists to stop.

      An integration with no price book returns null and every recommendation
      falls back to the engine's estimate, which is what happened everywhere
      before this.
    */
    adapter.capabilities.canPullPriceBook
      ? adapter.pullPriceBook(storeId).catch(() => null)
      : Promise.resolve(null),
  ])

  const priceBook = priced
    ? toPriceBook(priced.map((p) => ({
        code: p.code,
        description: p.description,
        laborAmount: p.laborAmount ?? 0,
        partsAmount: p.partsAmount ?? 0,
      })))
    : undefined

  return toPrepSheetInputs(bundle, profile, asOf, priceBook).map(buildPrepSheet)
}

/*
  `getDefaultStore()` used to live here — `SELECT * FROM stores LIMIT 1`.

  Deleted rather than deprecated. It was correct only for as long as the
  database held exactly one dealership, and on the second one every page that
  called it would have served the new customer another dealer's drive. The
  active rooftop now comes from the session: `getCurrentStore()` in
  @/lib/auth/session.
*/
